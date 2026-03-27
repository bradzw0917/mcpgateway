import { Router, Request, Response } from 'express';
import { getConfig } from '../config/index.js';
import { userManager, UserTokens } from '../user/index.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { exchangeCodeForToken, refreshAccessToken, storeUserTokens } from './token-manager.js';
import { logger } from '../utils/logger.js';

const router = Router();

// 存储待验证的授权码
const pendingCodes: Map<string, {
  userId: string;
  createdAt: number;
  tokens?: UserTokens;
}> = new Map();

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
 * 生成设备码
 */
function generateDeviceCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * GET /oauth/authorize - 启动 OAuth 授权流程
 */
router.get('/authorize', async (req: Request, res: Response): Promise<void> => {
  try {
    const config = getConfig();
    const clientState = req.query.state as string;
    const clientRedirectUri = req.query.redirect_uri as string;

    logger.info('Received OAuth authorize request', { clientState, clientRedirectUri });

    if (!clientState) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameter: state',
      });
      return;
    }

    // 生成 PKCE 参数
    const gatewayCodeVerifier = generateCodeVerifier();
    const gatewayCodeChallenge = generateCodeChallenge(gatewayCodeVerifier);
    const gatewayState = generateState();

    // 创建会话
    const userId = userManager.getDefaultUserId();
    userManager.createSession(
      userId,
      clientState,
      '',
      clientRedirectUri || '',
      gatewayState,
      gatewayCodeVerifier
    );

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

    logger.info(`Redirecting to Alicloud authorization for user: ${userId}`);

    // 重定向到阿里云授权页面
    res.redirect(authUrl.toString());
  } catch (err) {
    logger.error('Authorization error:', err);
    res.status(500).json({ error: 'server_error', error_description: (err as Error).message });
  }
});

/**
 * GET /oauth/callback - 阿里云 OAuth 回调端点
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      logger.error(`OAuth error: ${error}`, error_description);
      res.status(400).send(`
        <html>
          <head><title>Authorization Failed</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #ef4444;">Authorization Failed</h1>
            <p>Error: ${error}</p>
            <p>${error_description || ''}</p>
          </body>
        </html>
      `);
      return;
    }

    if (!state || typeof state !== 'string') {
      res.status(400).send('<h1>Error: Missing state parameter</h1>');
      return;
    }

    const session = userManager.getSessionByGatewayState(state);
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
    storeUserTokens(session.id, tokenResponse);

    logger.info(`OAuth successful for user: ${session.id}`);

    // 显示成功页面
    res.send(`
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f9fafb; }
            .container { background: white; border-radius: 12px; padding: 40px; max-width: 400px; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .success { color: #22c55e; font-size: 64px; margin-bottom: 20px; }
            h1 { color: #1f2937; margin: 0 0 10px; }
            p { color: #6b7280; margin: 0; }
            .instruction { margin-top: 30px; padding: 20px; background: #f3f4f6; border-radius: 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">✓</div>
            <h1>Authorization Successful!</h1>
            <p>You have been authenticated successfully.</p>
            <div class="instruction">
              <p><strong>Please return to Claude Code</strong></p>
              <p>Click "Reconnect" or run <code>/mcp</code> to continue</p>
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error('Callback error:', err);
    res.status(500).send(`
      <html>
        <head><title>Error</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #ef4444;">Authentication Failed</h1>
          <p>Error: ${(err as Error).message}</p>
        </body>
      </html>
    `);
  }
});

/**
 * POST /oauth/token - Token 端点
 */
router.post('/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { grant_type, code, refresh_token } = req.body;

    logger.info('Token request received', { grant_type });

    if (grant_type === 'authorization_code') {
      const userId = userManager.getDefaultUserId();
      const tokens = userManager.getTokens(userId);

      if (!tokens) {
        res.status(400).json({
          error: 'authorization_pending',
          error_description: 'Authorization not completed. Please complete OAuth in browser first.',
        });
        return;
      }

      logger.info(`Returning tokens for user: ${userId}`);

      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
        token_type: tokens.tokenType,
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
  const userId = (req.query.user_id as string) || req.headers['x-user-id'] as string || userManager.getDefaultUserId();
  const session = userManager.getSession(userId);
  const tokens = userManager.getTokens(userId);

  res.json({
    userId,
    hasSession: !!session,
    isAuthenticated: userManager.isAuthenticated(userId),
    tokens: tokens ? {
      hasAccessToken: !!tokens.accessToken,
      hasRefreshToken: !!tokens.refreshToken,
      expiresAt: new Date(tokens.expiresAt).toISOString(),
      tokenType: tokens.tokenType,
    } : null,
  });
});

/**
 * POST /oauth/logout - 登出
 */
router.post('/logout', (req: Request, res: Response): void => {
  const userId = (req.body.user_id as string) || req.headers['x-user-id'] as string || userManager.getDefaultUserId();
  const cleared = userManager.clearTokens(userId);

  if (cleared) {
    logger.info(`User logged out: ${userId}`);
    res.json({ success: true, message: 'Logged out successfully' });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

export default router;