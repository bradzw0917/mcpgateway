import express, { Express, Request, Response } from 'express';
import { getConfig, getServices, addService } from './config/index.js';
import { oauthRoutes, getGatewayBaseUrlFromRequest } from './oauth/index.js';
import { mcpProxyRouter } from './mcp-proxy/index.js';
import { userManager } from './user/index.js';
import { logger } from './utils/logger.js';

/**
 * 创建 Express 应用
 */
export function createApp(): Express {
  const app = express();
  const config = getConfig();

  // 中间件
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 请求日志
  app.use((req: Request, res: Response, next) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  // OAuth 元数据发现端点 - 必须在根路径
  // Claude Code 会访问 /.well-known/oauth-authorization-server
  app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
    const config = getConfig();
    const baseUrl = getGatewayBaseUrlFromRequest(req);

    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      scopes_supported: [config.oauth.scope],
    });
  });

  // 健康检查
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  // OAuth 路由 (用于用户通过浏览器完成认证)
  app.use('/oauth', oauthRoutes);

  // MCP 代理路由
  app.use('/', mcpProxyRouter);

  // 管理 API: 获取服务列表
  app.get('/config/services', (_req: Request, res: Response) => {
    res.json({
      baseUrl: config.mcpServer.baseUrl,
      services: getServices(),
    });
  });

  // 管理 API: 添加服务
  app.post('/config/services', (req: Request, res: Response) => {
    const { alias, path } = req.body;

    if (!alias || !path) {
      res.status(400).json({ error: 'Missing alias or path' });
      return;
    }

    addService(alias, path);
    logger.info(`Added service: ${alias} -> ${path}`);

    res.json({
      success: true,
      alias,
      path,
      services: getServices(),
    });
  });

  // 根路由
  app.get('/', (_req: Request, res: Response) => {
    const defaultUserId = userManager.getDefaultUserId();
    const isAuthenticated = userManager.isAuthenticated(defaultUserId);

    res.json({
      name: 'MCP Gateway',
      version: process.env.npm_package_version || '1.0.0',
      description: 'MCP Gateway for Alibaba Cloud OpenAPI MCP Server',
      authenticated: isAuthenticated,
      authenticateUrl: isAuthenticated ? null : '/oauth/authorize',
      endpoints: {
        mcp: '/:service/mcp',
        oauth: {
          authorize: '/oauth/authorize',
          callback: '/oauth/callback',
          status: '/oauth/status',
          logout: '/oauth/logout',
        },
        admin: {
          services: '/config/services',
          health: '/health',
        },
      },
    });
  });

  // 错误处理
  app.use((err: Error, _req: Request, res: Response, _next: () => void) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  });

  return app;
}