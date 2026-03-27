import fs from 'fs';
import path from 'path';
import { GatewayConfig, defaultConfig } from './config.js';

let config: GatewayConfig | null = null;

/**
 * 加载配置文件
 *
 * 配置优先级 (从高到低):
 * 1. 环境变量
 * 2. config.json 文件
 * 3. 默认值
 */
export function loadConfig(configPath?: string): GatewayConfig {
  if (config) {
    return config;
  }

  // 尝试从多个位置加载配置文件
  const configPaths = configPath
    ? [configPath]
    : [
        path.join(process.cwd(), 'config.json'),
        path.join(process.cwd(), '.mcp-gateway', 'config.json'),
        path.join(process.env.HOME || '', '.mcp-gateway', 'config.json'),
      ];

  let loadedConfig: Partial<GatewayConfig> = {};

  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf-8');
        loadedConfig = JSON.parse(content);
        console.log(`Loaded config from: ${p}`);
        break;
      } catch (err) {
        console.warn(`Failed to load config from ${p}:`, err);
      }
    }
  }

  // 合并默认配置
  config = mergeConfig(defaultConfig, loadedConfig);

  // 从环境变量覆盖 (最高优先级)
  applyEnvOverrides(config);

  // 验证配置
  validateConfig(config);

  return config;
}

/**
 * 获取当前配置
 */
export function getConfig(): GatewayConfig {
  if (!config) {
    return loadConfig();
  }
  return config;
}

/**
 * 合并配置
 */
function mergeConfig(
  defaults: Partial<GatewayConfig>,
  overrides: Partial<GatewayConfig>
): GatewayConfig {
  return {
    ...defaults,
    ...overrides,
    gatewayBaseUrl: overrides.gatewayBaseUrl || defaults.gatewayBaseUrl,
    oauth: {
      ...defaults.oauth!,
      ...overrides.oauth,
    },
    mcpServer: {
      ...defaults.mcpServer!,
      ...overrides.mcpServer,
    },
  } as GatewayConfig;
}

/**
 * 从环境变量覆盖配置
 */
function applyEnvOverrides(cfg: GatewayConfig): void {
  // Gateway 配置
  if (process.env.MCP_GATEWAY_PORT) {
    cfg.port = parseInt(process.env.MCP_GATEWAY_PORT, 10);
  }
  if (process.env.GATEWAY_BASE_URL) {
    cfg.gatewayBaseUrl = process.env.GATEWAY_BASE_URL;
  }

  // OAuth 配置
  if (process.env.OAUTH_CLIENT_ID) {
    cfg.oauth.clientId = process.env.OAUTH_CLIENT_ID;
  }
  if (process.env.OAUTH_AUTHORIZATION_ENDPOINT) {
    cfg.oauth.authorizationEndpoint = process.env.OAUTH_AUTHORIZATION_ENDPOINT;
  }
  if (process.env.OAUTH_TOKEN_ENDPOINT) {
    cfg.oauth.tokenEndpoint = process.env.OAUTH_TOKEN_ENDPOINT;
  }
  if (process.env.OAUTH_SCOPE) {
    cfg.oauth.scope = process.env.OAUTH_SCOPE;
  }
  if (process.env.OAUTH_CALLBACK_PORT) {
    cfg.oauth.callbackPort = parseInt(process.env.OAUTH_CALLBACK_PORT, 10);
  }

  // MCP Server 配置
  if (process.env.MCP_SERVER_BASE_URL) {
    cfg.mcpServer.baseUrl = process.env.MCP_SERVER_BASE_URL;
  }
}

/**
 * 验证配置
 */
function validateConfig(cfg: GatewayConfig): void {
  if (!cfg.oauth.clientId) {
    throw new Error('OAuth clientId is required. Set OAUTH_CLIENT_ID environment variable or configure in config.json');
  }

  if (cfg.port < 1 || cfg.port > 65535) {
    throw new Error(`Invalid port: ${cfg.port}`);
  }
}

/**
 * 动态添加 MCP 服务
 */
export function addService(alias: string, servicePath: string): void {
  const cfg = getConfig();
  cfg.mcpServer.services[alias] = servicePath;
}

/**
 * 获取所有已配置的服务
 */
export function getServices(): Record<string, string> {
  return getConfig().mcpServer.services;
}

/**
 * 获取 Gateway 的基础 URL
 */
export function getGatewayBaseUrl(): string | undefined {
  return getConfig().gatewayBaseUrl;
}