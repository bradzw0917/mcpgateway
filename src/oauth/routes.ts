import { Router, Request, Response } from 'express';
import { getConfig } from '../config/index.js';
import { userManager, UserTokens } from '../user/index.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { exchangeCodeForToken, refreshAccessToken, storeUserTokens } from './token-manager.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * 获取 Gateway 的基础 URL
 * 优先级: config.gatewayBaseUrl > 请求的 Host 头 > localhost
 */
export function getGatewayBaseUrlFromRequest(req: Request): string {
  const config = getConfig();
  const port = config.oauth.callbackPort || config.port;

  // 优先使用配置的地址 (来自 config.json 或 GATEWAY_BASE_URL 环境变量)
  if (config.gatewayBaseUrl) {
    return config.gatewayBaseUrl;
  }

  // 使用请求的 Host 头
  const host = req.get('host');
  if (host) {
    // 如果 Host 包含端口，直接使用
    if (host.includes(':')) {
      return `${req.protocol}://${host}`;
    }
    return `${req.protocol}://${host}:${port}`;
  }

  // 默认使用 localhost
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
 * GET /oauth/authorize - 启动 OAuth 授权流程
 * Claude Code 会调用此端点，传入 redirect_uri, state, code_challenge 等参数
 */
router.get('/authorize', async (req: Request, res: Response): Promise<void> => {
  try {
    const config = getConfig();

    // 获取 Claude Code 传入的参数
    const clientState = req.query.state as string;
    const clientCodeChallenge = req.query.code_challenge as string;
    const clientRedirectUri = req.query.redirect_uri as string;

    logger.info('Received OAuth authorize request', {
      clientState,
      clientCodeChallenge: clientCodeChallenge ? 'present' : 'missing',
      clientRedirectUri,
    });

    // 验证必要参数
    if (!clientState || !clientRedirectUri) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters: state, redirect_uri',
      });
      return;
    }

    // 生成 Gateway 自己的 PKCE 参数 (用于阿里云)
    const gatewayCodeVerifier = generateCodeVerifier();
    const gatewayCodeChallenge = generateCodeChallenge(gatewayCodeVerifier);
    const gatewayState = generateState();

    // 创建会话，存储两套 OAuth 参数
    const userId = userManager.getDefaultUserId();
    userManager.createSession(
      userId,
      clientState,
      clientCodeChallenge || '',
      clientRedirectUri,
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
    logger.debug(`Authorization URL: ${authUrl.toString()}`);

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

    // 处理授权错误
    if (error) {
      logger.error(`OAuth error: ${error}`, error_description);
      res.status(400).send(`
        <html>
          <head><title>Authorization Failed</title></head>
          <body>
            <h1>Authorization Failed</h1>
            <p>Error: ${error}</p>
            <p>Description: ${error_description || 'N/A'}</p>
          </body>
        </html>
      `);
      return;
    }

    // 验证 gateway state
    if (!state || typeof state !== 'string') {
      res.status(400).send('<h1>Error: Missing state parameter</h1>');
      return;
    }

    const session = userManager.getSessionByGatewayState(state);
    if (!session) {
      res.status(400).send('<h1>Error: Invalid or expired session</h1>');
      return;
    }

    // 验证授权码
    if (!code || typeof code !== 'string') {
      res.status(400).send('<h1>Error: Missing authorization code</h1>');
      return;
    }

    // 用授权码换取 Token (使用 Gateway 的 code_verifier)
    const alicloudCallbackUrl = buildAlicloudCallbackUrl(req);
    const tokenResponse = await exchangeCodeForToken(code, session.gatewayCodeVerifier, alicloudCallbackUrl);

    // 存储 Token
    storeUserTokens(session.id, tokenResponse);

    logger.info(`OAuth successful for user: ${session.id}`);

    // 重定向回 Claude Code 的 redirect_uri，带上原始的 state
    const redirectUrl = new URL(session.clientRedirectUri);
    redirectUrl.searchParams.set('code', 'success');  // 用一个假的授权码
    redirectUrl.searchParams.set('state', session.clientState);

    logger.info(`Redirecting back to client: ${redirectUrl.toString()}`);

    // 显示成功页面，然后自动跳转
    res.send(`
      <html>
        <head>
          <title>Authorization Successful</title>
          <meta http-equiv="refresh" content="2;url=${redirectUrl.toString()}">
        </head>
        <body>
          <h1>Authorization Successful!</h1>
          <p>You have been authenticated successfully.</p>
          <p>Redirecting back to Claude Code...</p>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error('Callback error:', err);
    res.status(500).send(`
      <html>
        <head><title>Error</title></head>
        <body>
          <h1>Authentication Failed</h1>
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
    const { grant_type, code, code_verifier, redirect_uri, refresh_token } = req.body;

    logger.info('Token request received', { grant_type });

    if (grant_type === 'authorization_code') {
      // Claude Code 用授权码换取 Token
      // 由于我们已经在 callback 中获取了 token，这里直接返回存储的 token
      const userId = userManager.getDefaultUserId();
      const tokens = userManager.getTokens(userId);

      if (!tokens) {
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'No tokens found. Please complete OAuth flow first.',
        });
        return;
      }

      // 返回存储的 token
      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
        token_type: tokens.tokenType,
      });
      return;
    }

    if (grant_type === 'refresh_token' && refresh_token) {
      // Token 刷新
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