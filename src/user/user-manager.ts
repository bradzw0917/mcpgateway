import { logger } from '../utils/logger.js';

/**
 * 用户 Token 信息
 */
export interface UserTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
}

/**
 * OAuth 授权请求信息 (来自 Claude Code)
 */
export interface OAuthRequest {
  state: string;  // Claude Code 的 state
  codeChallenge: string;  // Claude Code 的 code_challenge
  redirectUri: string;  // Claude Code 的回调地址
  createdAt: Date;
}

/**
 * 用户会话信息
 */
export interface UserSession {
  id: string;
  // Claude Code 的 OAuth 参数
  clientState: string;
  clientCodeChallenge: string;
  clientRedirectUri: string;
  // Gateway 的 OAuth 参数 (用于阿里云)
  gatewayState: string;
  gatewayCodeVerifier: string;
  tokens?: UserTokens;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 用户管理器（内存存储）
 */
class UserManager {
  private sessions: Map<string, UserSession> = new Map();
  private gatewayStateToSession: Map<string, string> = new Map();  // gatewayState -> sessionId
  private clientStateToSession: Map<string, string> = new Map();  // clientState -> sessionId

  /**
   * 创建新用户会话
   */
  createSession(
    userId: string,
    clientState: string,
    clientCodeChallenge: string,
    clientRedirectUri: string,
    gatewayState: string,
    gatewayCodeVerifier: string
  ): UserSession {
    const session: UserSession = {
      id: userId,
      clientState,
      clientCodeChallenge,
      clientRedirectUri,
      gatewayState,
      gatewayCodeVerifier,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(userId, session);
    this.gatewayStateToSession.set(gatewayState, userId);
    this.clientStateToSession.set(clientState, userId);

    logger.info(`Created session for user: ${userId}`);
    return session;
  }

  /**
   * 根据 Gateway state 获取会话
   */
  getSessionByGatewayState(gatewayState: string): UserSession | undefined {
    const userId = this.gatewayStateToSession.get(gatewayState);
    if (!userId) return undefined;
    return this.sessions.get(userId);
  }

  /**
   * 根据 Client state 获取会话
   */
  getSessionByClientState(clientState: string): UserSession | undefined {
    const userId = this.clientStateToSession.get(clientState);
    if (!userId) return undefined;
    return this.sessions.get(userId);
  }

  /**
   * 获取用户会话
   */
  getSession(userId: string): UserSession | undefined {
    return this.sessions.get(userId);
  }

  /**
   * 更新用户 Token
   */
  updateTokens(userId: string, tokens: UserTokens): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.tokens = tokens;
      session.updatedAt = new Date();
      logger.info(`Updated tokens for user: ${userId}`);
    } else {
      logger.warn(`User not found: ${userId}`);
    }
  }

  /**
   * 获取用户 Token
   */
  getTokens(userId: string): UserTokens | undefined {
    const session = this.sessions.get(userId);
    return session?.tokens;
  }

  /**
   * 清除用户 Token（登出）
   */
  clearTokens(userId: string): boolean {
    const session = this.sessions.get(userId);
    if (session) {
      session.tokens = undefined;
      session.updatedAt = new Date();
      logger.info(`Cleared tokens for user: ${userId}`);
      return true;
    }
    return false;
  }

  /**
   * 删除用户会话
   */
  deleteSession(userId: string): boolean {
    const session = this.sessions.get(userId);
    if (session) {
      this.sessions.delete(userId);
      this.gatewayStateToSession.delete(session.gatewayState);
      this.clientStateToSession.delete(session.clientState);
      logger.info(`Deleted session for user: ${userId}`);
      return true;
    }
    return false;
  }

  /**
   * 检查用户是否已认证
   */
  isAuthenticated(userId: string): boolean {
    const tokens = this.getTokens(userId);
    if (!tokens) {
      return false;
    }
    // 检查 token 是否过期（提前 5 分钟）
    return tokens.expiresAt > Date.now() + 5 * 60 * 1000;
  }

  /**
   * 获取默认用户 ID
   */
  getDefaultUserId(): string {
    return 'default';
  }
}

// 单例实例
export const userManager = new UserManager();