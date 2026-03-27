import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { logger } from './utils/logger.js';

// 加载配置
const config = loadConfig();

// 创建应用
const app = createApp();

// 启动服务器
const server = app.listen(config.port, () => {
  logger.info(`MCP Gateway started on port ${config.port}`);
  logger.info(`OAuth Client ID: ${config.oauth.clientId}`);
  logger.info(`MCP Server Base URL: ${config.mcpServer.baseUrl}`);
  logger.info(`Configured services: ${Object.keys(config.mcpServer.services).join(', ') || 'none'}`);
  logger.info('');
  logger.info('Endpoints:');
  logger.info(`  - MCP Proxy: http://localhost:${config.port}/:service/mcp`);
  logger.info(`  - OAuth Authorize: http://localhost:${config.port}/oauth/authorize`);
  logger.info(`  - OAuth Callback: http://localhost:${config.port}/oauth/callback`);
  logger.info(`  - Health Check: http://localhost:${config.port}/health`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});