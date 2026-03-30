import { Router, Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/index.js';
import { getValidAccessToken } from '../oauth/token-manager.js';
import { logger } from '../utils/logger.js';

// 导入 oauthSessions（临时解决方案）
import { Router as OAuthRouter } from 'express';
const oauthSessions: Map<string, any> = new Map();

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

  // 从 Authorization header 获取 token
  const authHeader = req.headers.authorization as string;
  if (!authHeader?.startsWith('Bearer ')) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.setHeader('WWW-Authenticate', `Bearer realm="MCP Gateway"`);
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Authentication required',
        data: {
          authorize_url: `${baseUrl}/oauth/authorize`,
        },
      },
      id: null,
    });
    return;
  }

  const accessToken = authHeader.substring(7);

  try {
    // 构建目标 URL
    const targetUrl = `${config.mcpServer.baseUrl}${servicePath}`;
    logger.info(`Proxying request to: ${targetUrl}`);

    // 准备请求头 - 使用 Claude Code 传来的 access token
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

    logger.info(`Response status: ${statusCode}`);
    res.status(statusCode).send(body);
  } catch (err) {
    logger.error('Proxy error:', err);
    res.status(502).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Proxy error',
        data: { details: (err as Error).message },
      },
      id: null,
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