import { Router, Request, Response } from 'express';
import { getConfig } from '../config/index.js';
import { userManager, UserTokens } from '../user/index.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { exchangeCodeForToken, refreshAccessToken, storeUserTokens } from './token-manager.js';
import { logger } from '../utils/logger.js';

const router = Router();

// 存储 OAuth 会话信息
const oauthSessions: Map<string, {
  clientState: string;
  clientRedirectUri: string;
  clientCodeChallenge: string;
  gatewayCodeVerifier: string;
  gatewayState: string;
  createdAt: number;
  tokens?: UserTokens;
  authCode?: string;
}> = new Map();

// 存储授权码到会话的映射
const authCodeToSession: Map<string, string> = new Map();

/**
 * 获取 Gateway 的基础 URL
 */
export function getGatewayBaseUrlFromRequest(req: Request): string {
  const config = getConfig();
  const port = config.oauth.callbackPort || config.port;

  if (config.gatewayBaseUrl) {
    return config.gatewayBaseUrl;
  }

  const host = req.get('host');
  if (host) {
    if (host.includes(':')) {
      return `${req.protocol}://${host}`;
    }
    return `${req.protocol}://${host}:${port}`;
  }

  return `http://localhost:${port}`;
}

/**
 * 构建阿里云回调 URL
 */
function buildAlicloudCallbackUrl(req: Request): string {
  const baseUrl = getGatewayBaseUrlFromRequest(req);
  return `${baseUrl}/oauth/callback`;
}

/**
 * 生成授权码
 */
function generateAuthCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 32; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * GET /.well-known/oauth-authorization-server - OAuth 元数据发现
 */
router.get('/.well-known/oauth-authorization-server', (req: Request, res: Response): void => {
  const config = getConfig();
  const baseUrl = getGatewayBaseUrlFromRequest(req);

  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: [config.oauth.scope],
  });
});

/**
 * GET /oauth/authorize - 启动 OAuth 授权流程
 */
router.get('/authorize', async (req: Request, res: Response): Promise<void> => {
  try {
    const config = getConfig();
    const clientState = req.query.state as string;
    const clientCodeChallenge = req.query.code_challenge as string;
    const clientRedirectUri = req.query.redirect_uri as string;

    logger.info('OAuth authorize request', {
      clientState,
      clientRedirectUri,
      clientCodeChallenge: clientCodeChallenge ? 'present' : 'missing'
    });

    if (!clientState) {
      res.status(400).send('<h1>Error: Missing state parameter</h1>');
      return;
    }

    // 生成 PKCE 参数
    const gatewayCodeVerifier = generateCodeVerifier();
    const gatewayCodeChallenge = generateCodeChallenge(gatewayCodeVerifier);
    const gatewayState = generateState();

    // 创建会话
    const sessionId = gatewayState;
    oauthSessions.set(sessionId, {
      clientState,
      clientRedirectUri: clientRedirectUri || '',
      clientCodeChallenge: clientCodeChallenge || '',
      gatewayCodeVerifier,
      gatewayState,
      createdAt: Date.now(),
    });

    // 构建阿里云授权 URL
    const alicloudCallbackUrl = buildAlicloudCallbackUrl(req);
    const authUrl = new URL(config.oauth.authorizationEndpoint);
    authUrl.searchParams.set('client_id', config.oauth.clientId);
    authUrl.searchParams.set('redirect_uri', alicloudCallbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', config.oauth.scope);
    authUrl.searchParams.set('state', gatewayState);
    authUrl.searchParams.set('code_challenge', gatewayCodeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    logger.info(`Redirecting to Alicloud authorization`);
    res.redirect(authUrl.toString());
  } catch (err) {
    logger.error('Authorization error:', err);
    res.status(500).send(`<h1>Error: ${(err as Error).message}</h1>`);
  }
});

/**
 * GET /oauth/callback - 阿里云 OAuth 回调端点
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error, error_description } = req.query;

    logger.info('OAuth callback received', { code: !!code, state, error });

    if (error) {
      res.status(400).send(`
        <html><head><title>Authorization Failed</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #ef4444;">Authorization Failed</h1>
          <p>Error: ${error}</p>
          <p>${error_description || ''}</p>
        </body></html>
      `);
      return;
    }

    if (!state || typeof state !== 'string') {
      res.status(400).send('<h1>Error: Missing state parameter</h1>');
      return;
    }

    const session = oauthSessions.get(state);
    if (!session) {
      res.status(400).send('<h1>Error: Invalid or expired session</h1>');
      return;
    }

    if (!code || typeof code !== 'string') {
      res.status(400).send('<h1>Error: Missing authorization code</h1>');
      return;
    }

    // 用授权码换取 Token
    const alicloudCallbackUrl = buildAlicloudCallbackUrl(req);
    const tokenResponse = await exchangeCodeForToken(code, session.gatewayCodeVerifier, alicloudCallbackUrl);

    // 存储 Token
    const tokens: UserTokens = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || '',
      expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      tokenType: tokenResponse.token_type,
    };
    session.tokens = tokens;

    // 生成授权码给用户复制
    const authCode = generateAuthCode();
    session.authCode = authCode;
    authCodeToSession.set(authCode, state);

    logger.info(`OAuth successful, auth code generated: ${authCode}`);

    // 显示成功页面，让用户复制授权码
    res.send(`
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f9fafb; }
            .container { background: white; border-radius: 12px; padding: 40px; max-width: 500px; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .success { color: #22c55e; font-size: 64px; }
            h1 { color: #1f2937; margin: 0 0 10px; }
            p { color: #6b7280; margin: 0 0 20px; }
            .code-box { background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .code { font-family: monospace; font-size: 24px; letter-spacing: 2px; color: #1f2937; }
            .instruction { margin-top: 30px; padding: 20px; background: #fef3c7; border-radius: 8px; text-align: left; }
            .instruction h3 { margin: 0 0 10px; color: #92400e; }
            .instruction ol { margin: 0; padding-left: 20px; color: #78350f; }
            button { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-size: 16px; cursor: pointer; margin-top: 10px; }
            button:hover { background: #2563eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">✓</div>
            <h1>Authorization Successful!</h1>
            <p>You have been authenticated successfully.</p>

            <div class="code-box">
              <p style="margin-bottom: 10px; font-weight: bold;">Your Authorization Code:</p>
              <div class="code" id="authCode">${authCode}</div>
              <button onclick="copyCode()">📋 Copy Code</button>
            </div>

            <div class="instruction">
              <h3>Next Steps:</h3>
              <ol>
                <li>Copy the authorization code above</li>
                <li>Return to Claude Code</li>
                <li>Paste the code when prompted</li>
              </ol>
            </div>
          </div>
          <script>
            function copyCode() {
              navigator.clipboard.writeText('${authCode}');
              alert('Code copied to clipboard!');
            }
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error('Callback error:', err);
    res.status(500).send(`
      <html><head><title>Error</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: #ef4444;">Authentication Failed</h1>
        <p>Error: ${(err as Error).message}</p>
      </body></html>
    `);
  }
});

/**
 * POST /oauth/token - Token 端点
 */
router.post('/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { grant_type, code, refresh_token } = req.body;

    logger.info('Token request received', { grant_type, code });

    if (grant_type === 'authorization_code' && code) {
      // 查找会话
      const sessionId = authCodeToSession.get(code);
      if (!sessionId) {
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid authorization code',
        });
        return;
      }

      const session = oauthSessions.get(sessionId);
      if (!session || !session.tokens) {
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Session not found or expired',
        });
        return;
      }

      // 删除授权码（一次性使用）
      authCodeToSession.delete(code);

      logger.info(`Returning tokens for session: ${sessionId}`);

      res.json({
        access_token: session.tokens.accessToken,
        refresh_token: session.tokens.refreshToken,
        expires_in: Math.max(0, Math.floor((session.tokens.expiresAt - Date.now()) / 1000)),
        token_type: session.tokens.tokenType,
      });
      return;
    }

    if (grant_type === 'refresh_token' && refresh_token) {
      const config = getConfig();
      const tokenResponse = await fetch(config.oauth.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: config.oauth.clientId,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        res.status(tokenResponse.status).json({ error: 'invalid_grant', error_description: errorText });
        return;
      }

      const data = await tokenResponse.json();
      res.json(data);
      return;
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (err) {
    logger.error('Token error:', err);
    res.status(500).json({ error: 'server_error', error_description: (err as Error).message });
  }
});

/**
 * GET /oauth/status - 查看认证状态
 */
router.get('/status', (req: Request, res: Response): void => {
  res.json({
    message: 'OAuth status endpoint',
    activeSessions: oauthSessions.size,
  });
});

/**
 * POST /oauth/logout - 登出
 */
router.post('/logout', (req: Request, res: Response): void => {
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;