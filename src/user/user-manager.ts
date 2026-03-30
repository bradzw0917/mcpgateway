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
 * 设备授权信息
 */
export interface DeviceAuth {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  createdAt: Date;
  // 授权完成后存储
  tokens?: UserTokens;
  // 关联的用户ID
  userId?: string;
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
  private deviceAuths: Map<string, DeviceAuth> = new Map();
  private userCodeToDeviceCode: Map<string, string> = new Map();
  private tokenToUser: Map<string, string> = new Map();  // accessToken -> userId

  /**
   * 通过 access token 获取用户 ID
   */
  getUserIdByToken(token: string): string | undefined {
    return this.tokenToUser.get(token);
  }

  /**
   * 创建设备授权请求
   */
  createDeviceAuth(verificationUri: string): DeviceAuth {
    const deviceCode = this.generateCode(32);
    const userCode = this.generateCode(8).toUpperCase();

    const deviceAuth: DeviceAuth = {
      deviceCode,
      userCode,
      verificationUri: `${verificationUri}?user_code=${userCode}`,
      expiresIn: 600, // 10分钟过期
      interval: 5, // 每5秒轮询一次
      createdAt: new Date(),
    };

    this.deviceAuths.set(deviceCode, deviceAuth);
    this.userCodeToDeviceCode.set(userCode, deviceCode);

    logger.info(`Created device auth: userCode=${userCode}`);
    return deviceAuth;
  }

  /**
   * 通过 user_code 获取设备授权信息
   */
  getDeviceAuthByUserCode(userCode: string): DeviceAuth | undefined {
    const deviceCode = this.userCodeToDeviceCode.get(userCode.toUpperCase());
    if (!deviceCode) return undefined;
    return this.deviceAuths.get(deviceCode);
  }

  /**
   * 通过 device_code 获取设备授权信息
   */
  getDeviceAuth(deviceCode: string): DeviceAuth | undefined {
    return this.deviceAuths.get(deviceCode);
  }

  /**
   * 完成设备授权（存储 Token）
   */
  completeDeviceAuth(deviceCode: string, tokens: UserTokens): string {
    const deviceAuth = this.deviceAuths.get(deviceCode);
    if (!deviceAuth) {
      throw new Error('Invalid device code');
    }

    // 创建用户会话
    const userId = `user_${Date.now()}`;
    const session: UserSession = {
      id: userId,
      tokens,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(userId, session);

    // 存储 token 到用户的映射
    this.tokenToUser.set(tokens.accessToken, userId);

    // 更新设备授权信息
    deviceAuth.tokens = tokens;
    deviceAuth.userId = userId;

    logger.info(`Device auth completed: deviceCode=${deviceCode}, userId=${userId}`);
    return userId;
  }

  /**
   * 检查设备授权状态
   */
  checkDeviceAuth(deviceCode: string): { authorized: boolean; userId?: string; error?: string } {
    const deviceAuth = this.deviceAuths.get(deviceCode);

    if (!deviceAuth) {
      return { authorized: false, error: 'invalid_device_code' };
    }

    // 检查是否过期
    const elapsed = (Date.now() - deviceAuth.createdAt.getTime()) / 1000;
    if (elapsed > deviceAuth.expiresIn) {
      this.deviceAuths.delete(deviceCode);
      this.userCodeToDeviceCode.delete(deviceAuth.userCode);
      return { authorized: false, error: 'expired_device_code' };
    }

    if (deviceAuth.tokens && deviceAuth.userId) {
      return { authorized: true, userId: deviceAuth.userId };
    }

    return { authorized: false, error: 'authorization_pending' };
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
    // 检查 token 是否过期（提前 5 分钟）
    return tokens.expiresAt > Date.now() + 5 * 60 * 1000;
  }

  /**
   * 生成随机码
   */
  private generateCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * 清理过期的设备授权
   */
  cleanupExpiredDeviceAuths(): void {
    const now = Date.now();
    for (const [deviceCode, deviceAuth] of this.deviceAuths.entries()) {
      const elapsed = (now - deviceAuth.createdAt.getTime()) / 1000;
      if (elapsed > deviceAuth.expiresIn) {
        this.deviceAuths.delete(deviceCode);
        this.userCodeToDeviceCode.delete(deviceAuth.userCode);
        logger.info(`Cleaned up expired device auth: ${deviceCode}`);
      }
    }
  }
}

// 单例实例
export const userManager = new UserManager();

// 定期清理过期授权
setInterval(() => {
  userManager.cleanupExpiredDeviceAuths();
}, 60000); // 每分钟清理一次