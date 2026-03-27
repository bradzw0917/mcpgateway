import { Router, Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/index.js';
import { userManager } from '../user/index.js';
import { getValidAccessToken } from '../oauth/token-manager.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * MCP 请求代理中间件
 */
export async function proxyMCPRequest(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  const config = getConfig();
  const serviceAlias = req.params.service;

  // 查找服务路径
  const servicePath = config.mcpServer.services[serviceAlias];
  if (!servicePath) {
    res.status(404).json({
      error: 'Service not found',
      message: `No service configured for alias: ${serviceAlias}`,
      availableServices: Object.keys(config.mcpServer.services),
    });
    return;
  }

  // 获取用户 ID
  const userId = (req.headers['x-user-id'] as string) || userManager.getDefaultUserId();

  // 检查用户是否已认证
  if (!userManager.isAuthenticated(userId)) {
    res.status(401).json({
      error: 'Not authenticated',
      message: `User ${userId} is not authenticated. Please complete OAuth flow first.`,
      authorizeUrl: `/oauth/authorize?user_id=${userId}`,
    });
    return;
  }

  try {
    // 获取有效的 Access Token
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Failed to get valid access token',
      });
      return;
    }

    // 构建目标 URL
    const targetUrl = `${config.mcpServer.baseUrl}${servicePath}`;
    logger.debug(`Proxying request to: ${targetUrl}`);

    // 准备请求头
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Content-Type', 'application/json');

    // 复制其他必要的头
    const copyHeaders = ['accept', 'accept-encoding', 'accept-language'];
    for (const h of copyHeaders) {
      const value = req.headers[h];
      if (value) {
        headers.set(h, Array.isArray(value) ? value[0] : value);
      }
    }

    // 转发请求
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    // 复制响应头
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // 返回响应
    const statusCode = response.status;
    const body = await response.text();

    logger.debug(`Response status: ${statusCode}`);
    res.status(statusCode).send(body);
  } catch (err) {
    logger.error('Proxy error:', err);
    res.status(502).json({
      error: 'Proxy error',
      message: (err as Error).message,
    });
  }
}

/**
 * POST /:service/mcp - MCP 请求代理
 */
router.post('/:service/mcp', proxyMCPRequest);

/**
 * GET /:service/mcp - MCP 资源请求
 */
router.get('/:service/mcp', proxyMCPRequest);

export default router;