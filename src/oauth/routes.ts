import { Router, Request, Response } from 'express';
import { getConfig } from '../config/index.js';
import { userManager } from '../user/index.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { exchangeCodeForToken, storeUserTokens, getValidAccessToken } from './token-manager.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * 构建回调 URL
 */
function buildCallbackUrl(): string {
  const config = getConfig();
  const port = config.oauth.callbackPort || config.port;
  const host = process.env.OAUTH_CALLBACK_HOST || 'localhost';
  return `http://${host}:${port}/oauth/callback`;
}

/**
 * GET /oauth/authorize - 启动 OAuth 授权流程
 */
router.get('/authorize', async (req: Request, res: Response): Promise<void> => {
  try {
    const config = getConfig();
    const userId = (req.query.user_id as string) || userManager.getDefaultUserId();
    const callbackUrl = buildCallbackUrl();

    // 生成 PKCE 参数
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // 创建用户会话
    userManager.createSession(userId, state, codeVerifier);

    // 构建授权 URL
    const authUrl = new URL(config.oauth.authorizationEndpoint);
    authUrl.searchParams.set('client_id', config.oauth.clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', config.oauth.scope);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    logger.info(`Redirecting to authorization endpoint for user: ${userId}`);
    logger.debug(`Authorization URL: ${authUrl.toString()}`);

    res.redirect(authUrl.toString());
  } catch (err) {
    logger.error('Authorization error:', err);
    res.status(500).json({ error: 'Authorization failed', message: (err as Error).message });
  }
});

/**
 * GET /oauth/callback - OAuth 回调端点
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error, error_description } = req.query;

    // 处理授权错误
    if (error) {
      logger.error(`OAuth error: ${error}`, error_description);
      res.status(400).json({
        error: 'OAuth error',
        code: error,
        description: error_description,
      });
      return;
    }

    // 验证 state
    if (!state || typeof state !== 'string') {
      res.status(400).json({ error: 'Missing state parameter' });
      return;
    }

    const userId = userManager.getUserIdByState(state);
    if (!userId) {
      res.status(400).json({ error: 'Invalid state parameter' });
      return;
    }

    const session = userManager.getSession(userId);
    if (!session) {
      res.status(400).json({ error: 'Session not found' });
      return;
    }

    // 验证授权码
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing authorization code' });
      return;
    }

    // 用授权码换取 Token
    const callbackUrl = buildCallbackUrl();
    const tokenResponse = await exchangeCodeForToken(code, session.codeVerifier, callbackUrl);

    // 存储 Token
    storeUserTokens(userId, tokenResponse);

    logger.info(`OAuth successful for user: ${userId}`);

    // 返回成功页面
    res.send(`
      <html>
        <head><title>Authorization Successful</title></head>
        <body>
          <h1>Authorization Successful</h1>
          <p>You have been authenticated successfully.</p>
          <p>You can close this window and return to Claude Code.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error('Callback error:', err);
    res.status(500).json({
      error: 'Authentication failed',
      message: (err as Error).message,
    });
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

/**
 * GET /oauth/token - 获取 Access Token (供 MCP 代理使用)
 */
router.get('/token', async (req: Request, res: Response): Promise<void> => {
  const userId = (req.query.user_id as string) || req.headers['x-user-id'] as string || userManager.getDefaultUserId();

  try {
    const accessToken = await getValidAccessToken(userId);

    if (!accessToken) {
      res.status(401).json({ error: 'Not authenticated', userId });
      return;
    }

    res.json({ accessToken, userId });
  } catch (err) {
    logger.error('Get token error:', err);
    res.status(500).json({ error: 'Failed to get token', message: (err as Error).message });
  }
});

export default router;