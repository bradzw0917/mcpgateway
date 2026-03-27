import { getConfig } from '../config/index.js';
import { userManager, UserTokens } from '../user/index.js';
import { logger } from '../utils/logger.js';

/**
 * Token 响应
 */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/**
 * 用授权码换取 Token
 */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<TokenResponse> {
  const config = getConfig();
  const { clientId, tokenEndpoint } = config.oauth;

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });

  logger.debug('Exchanging code for token...');
  logger.debug(`Token endpoint: ${tokenEndpoint}`);

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Token exchange failed:', errorText);
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as TokenResponse;
  logger.info('Token exchange successful');
  return data;
}

/**
 * 刷新 Token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  const config = getConfig();
  const { clientId, tokenEndpoint } = config.oauth;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  logger.debug('Refreshing access token...');

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Token refresh failed:', errorText);
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as TokenResponse;
  logger.info('Token refresh successful');
  return data;
}

/**
 * 存储用户 Token
 */
export function storeUserTokens(
  userId: string,
  tokenResponse: TokenResponse
): UserTokens {
  const tokens: UserTokens = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || '',
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
    tokenType: tokenResponse.token_type,
  };

  userManager.updateTokens(userId, tokens);
  return tokens;
}

/**
 * 获取有效的 Access Token（自动刷新）
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const tokens = userManager.getTokens(userId);

  if (!tokens) {
    logger.warn(`No tokens found for user: ${userId}`);
    return null;
  }

  // 检查是否需要刷新（提前 5 分钟）
  const needsRefresh = tokens.expiresAt <= Date.now() + 5 * 60 * 1000;

  if (needsRefresh && tokens.refreshToken) {
    try {
      logger.info(`Refreshing token for user: ${userId}`);
      const newTokens = await refreshAccessToken(tokens.refreshToken);
      const storedTokens = storeUserTokens(userId, newTokens);
      return storedTokens.accessToken;
    } catch (err) {
      logger.error(`Failed to refresh token for user ${userId}:`, err);
      // 刷新失败，清除 token
      userManager.clearTokens(userId);
      return null;
    }
  }

  return tokens.accessToken;
}