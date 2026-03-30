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
 * 用户会话信息
 */
export interface UserSession {
  id: string;
  tokens?: UserTokens;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 用户管理器（内存存储）
 */
class UserManager {
  private sessions: Map<string, UserSession> = new Map();

  /**
   * 创建用户会话
   */
  createSession(userId: string): UserSession {
    const session: UserSession = {
      id: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(userId, session);
    logger.info(`Created session for user: ${userId}`);
    return session;
  }

  /**
   * 获取用户会话
   */
  getSession(userId: string): UserSession | undefined {
    return this.sessions.get(userId);
  }

  /**
   * 获取用户 Token
   */
  getTokens(userId: string): UserTokens | undefined {
    const session = this.sessions.get(userId);
    return session?.tokens;
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
    }
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
   * 检查用户是否已认证
   */
  isAuthenticated(userId: string): boolean {
    const tokens = this.getTokens(userId);
    if (!tokens) {
      return false;
    }
    return tokens.expiresAt > Date.now() + 5 * 60 * 1000;
  }
}

// 单例实例
export const userManager = new UserManager();