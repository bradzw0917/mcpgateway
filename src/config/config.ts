/**
 * Gateway 配置接口
 */
export interface GatewayConfig {
  /** Gateway 监听端口 */
  port: number;

  /** Gateway 的公网访问地址 (用于 OAuth 回调) */
  gatewayBaseUrl?: string;

  /** OAuth 配置 */
  oauth: OAuthConfig;

  /** MCP Server 配置 */
  mcpServer: MCPServerConfig;
}

export interface OAuthConfig {
  /** OAuth Client ID (Native 应用) */
  clientId: string;

  /** 授权端点 */
  authorizationEndpoint: string;

  /** Token 端点 */
  tokenEndpoint: string;

  /** 权限范围 */
  scope: string;

  /** 回调端口 (可选，默认使用 Gateway 端口) */
  callbackPort?: number;
}

export interface MCPServerConfig {
  /** MCP Server 基础 URL */
  baseUrl: string;

  /** MCP 服务路径映射: alias -> path */
  services: Record<string, string>;
}

/**
 * 默认配置
 */
export const defaultConfig: Partial<GatewayConfig> = {
  port: 3000,
  gatewayBaseUrl: undefined,
  oauth: {
    clientId: '',
    authorizationEndpoint: 'https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/authorize',
    tokenEndpoint: 'https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/token',
    scope: '/acs/mcp-server',
  },
  mcpServer: {
    baseUrl: 'https://openapi-mcp-intl.vpc-proxy.aliyuncs.com',
    services: {},
  },
};