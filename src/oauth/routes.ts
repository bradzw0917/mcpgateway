import { Router, Request, Response } from 'express';
import { getConfig } from '../config/index.js';
import { userManager, UserTokens } from '../user/index.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { exchangeCodeForToken, refreshAccessToken, storeUserTokens } from './token-manager.js';
import { logger } from '../utils/logger.js';

const router = Router();

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
 * GET /.well-known/oauth-authorization-server - OAuth 元数据发现
 */
router.get('/.well-known/oauth-authorization-server', (req: Request, res: Response): void => {
  const config = getConfig();
  const baseUrl = getGatewayBaseUrlFromRequest(req);

  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/device/auth`,
    token_endpoint: `${baseUrl}/oauth/token`,
    device_authorization_endpoint: `${baseUrl}/oauth/device/auth`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
    scopes_supported: [config.oauth.scope],
  });
});

/**
 * POST /oauth/device/auth - 设备授权端点
 * Claude Code 会调用此端点获取设备码
 */
router.post('/device/auth', (req: Request, res: Response): void => {
  const baseUrl = getGatewayBaseUrlFromRequest(req);

  // 创建设备授权
  const deviceAuth = userManager.createDeviceAuth(`${baseUrl}/oauth/verify`);

  logger.info(`Device auth created: deviceCode=${deviceAuth.deviceCode}, userCode=${deviceAuth.userCode}`);

  res.json({
    device_code: deviceAuth.deviceCode,
    user_code: deviceAuth.userCode,
    verification_uri: deviceAuth.verificationUri,
    verification_uri_complete: deviceAuth.verificationUri,
    expires_in: deviceAuth.expiresIn,
    interval: deviceAuth.interval,
  });
});

/**
 * GET /oauth/verify - 用户验证页面
 * 用户在此页面输入 user_code 并完成授权
 */
router.get('/verify', async (req: Request, res: Response): Promise<void> => {
  const userCode = (req.query.user_code as string)?.toUpperCase();

  if (!userCode) {
    res.send(`
      <html>
        <head><title>Device Authorization</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Device Authorization</h1>
          <p>Please enter your device code:</p>
          <form method="get">
            <input type="text" name="user_code" placeholder="Enter code" style="font-size: 24px; padding: 10px; text-align: center; letter-spacing: 5px;" maxlength="8" />
            <br><br>
            <button type="submit" style="font-size: 18px; padding: 10px 30px;">Continue</button>
          </form>
        </body>
      </html>
    `);
    return;
  }

  const deviceAuth = userManager.getDeviceAuthByUserCode(userCode);

  if (!deviceAuth) {
    res.status(400).send(`
      <html>
        <head><title>Invalid Code</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #ef4444;">Invalid Code</h1>
          <p>The code you entered is invalid or expired.</p>
          <a href="/oauth/verify">Try again</a>
        </body>
      </html>
    `);
    return;
  }

  // 重定向到阿里云授权
  const config = getConfig();
  const gatewayCodeVerifier = generateCodeVerifier();
  const gatewayCodeChallenge = generateCodeChallenge(gatewayCodeVerifier);
  const gatewayState = generateState();

  // 存储 PKCE 参数到设备授权中（我们需要在回调时使用）
  (deviceAuth as any).codeVerifier = gatewayCodeVerifier;
  (deviceAuth as any).state = gatewayState;

  const alicloudCallbackUrl = buildAlicloudCallbackUrl(req);
  const authUrl = new URL(config.oauth.authorizationEndpoint);
  authUrl.searchParams.set('client_id', config.oauth.clientId);
  authUrl.searchParams.set('redirect_uri', alicloudCallbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', config.oauth.scope);
  authUrl.searchParams.set('state', `${gatewayState}:${userCode}`);
  authUrl.searchParams.set('code_challenge', gatewayCodeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  logger.info(`Redirecting to Alicloud for device auth: userCode=${userCode}`);
  res.redirect(authUrl.toString());
});

/**
 * GET /oauth/callback - 阿里云 OAuth 回调端点
 */
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error, error_description } = req.query;

    logger.info('OAuth callback received', { code: !!code, state, error });

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

    // 解析 state (格式: gatewayState:userCode)
    const stateParts = (state as string)?.split(':');
    if (!stateParts || stateParts.length !== 2) {
      res.status(400).send('<h1>Error: Invalid state parameter</h1>');
      return;
    }

    const [gatewayState, userCode] = stateParts;
    const deviceAuth = userManager.getDeviceAuthByUserCode(userCode);

    if (!deviceAuth) {
      res.status(400).send('<h1>Error: Invalid or expired device code</h1>');
      return;
    }

    if (!code || typeof code !== 'string') {
      res.status(400).send('<h1>Error: Missing authorization code</h1>');
      return;
    }

    // 用授权码换取 Token
    const alicloudCallbackUrl = buildAlicloudCallbackUrl(req);
    const tokenResponse = await exchangeCodeForToken(code, (deviceAuth as any).codeVerifier, alicloudCallbackUrl);

    // 存储 Token
    const tokens: UserTokens = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || '',
      expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      tokenType: tokenResponse.token_type,
    };

    // 完成设备授权
    const userId = userManager.completeDeviceAuth(deviceAuth.deviceCode, tokens);

    logger.info(`OAuth successful for device: userCode=${userCode}, userId=${userId}`);

    // 显示成功页面
    res.send(`
      <html>
        <head><title>Authorization Successful</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #f9fafb;">
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 400px; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="color: #22c55e; font-size: 64px;">✓</div>
            <h1 style="color: #1f2937;">Authorization Successful!</h1>
            <p style="color: #6b7280;">You have been authenticated successfully.</p>
            <p style="color: #6b7280;">Please return to Claude Code to continue.</p>
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
    const { grant_type, device_code, code, refresh_token } = req.body;

    logger.info('Token request received', { grant_type, device_code, code });

    // 设备授权码模式
    if (grant_type === 'urn:ietf:params:oauth:grant-type:device_code' && device_code) {
      const result = userManager.checkDeviceAuth(device_code);

      if (result.error === 'invalid_device_code') {
        res.status(400).json({ error: 'invalid_device_code', error_description: 'Invalid device code' });
        return;
      }

      if (result.error === 'expired_device_code') {
        res.status(400).json({ error: 'expired_device_code', error_description: 'Device code expired' });
        return;
      }

      if (result.error === 'authorization_pending') {
        res.status(400).json({ error: 'authorization_pending', error_description: 'Authorization pending' });
        return;
      }

      // 授权完成，返回 Token
      const tokens = userManager.getTokens(result.userId!);
      if (!tokens) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Tokens not found' });
        return;
      }

      logger.info(`Returning tokens for device: deviceCode=${device_code}, userId=${result.userId}`);

      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
        token_type: tokens.tokenType,
      });
      return;
    }

    // 授权码模式（用于兼容）
    if (grant_type === 'authorization_code' && code) {
      const userId = 'default';
      const tokens = userManager.getTokens(userId);

      if (!tokens) {
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Authorization not completed or expired.',
        });
        return;
      }

      res.json({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000)),
        token_type: tokens.tokenType,
      });
      return;
    }

    // Token 刷新
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
  const userId = req.query.user_id as string;
  const deviceCode = req.query.device_code as string;

  if (deviceCode) {
    const result = userManager.checkDeviceAuth(deviceCode);
    res.json(result);
    return;
  }

  if (userId) {
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
    return;
  }

  res.json({ error: 'Missing user_id or device_code' });
});

/**
 * POST /oauth/logout - 登出
 */
router.post('/logout', (req: Request, res: Response): void => {
  const userId = req.body.user_id as string;
  if (!userId) {
    res.status(400).json({ error: 'Missing user_id' });
    return;
  }

  const cleared = userManager.clearTokens(userId);
  if (cleared) {
    logger.info(`User logged out: ${userId}`);
    res.json({ success: true, message: 'Logged out successfully' });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

export default router;