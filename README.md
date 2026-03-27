# MCP Gateway

MCP Gateway 是一个代理服务，用于连接 Claude Code 和阿里云国际站 OpenAPI MCP Server。

## 功能特性

- **MCP 代理**: 将 Claude Code 的 MCP 请求转发到阿里云后端
- **OAuth 2.1 认证**: 支持 Native 应用的 OAuth 2.1 + PKCE 流程
- **多用户支持**: 每个用户使用自己的阿里云账号授权
- **动态配置**: 支持动态添加 MCP 服务

## 文档

- [部署文档](DEPLOYMENT.md) - 详细的服务器部署指南

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

复制示例配置文件：

```bash
cp config.example.json config.json
```

编辑 `config.json`，设置你的 OAuth Client ID：

```json
{
  "port": 3000,
  "oauth": {
    "clientId": "YOUR_CLIENT_ID"
  },
  "mcpServer": {
    "services": {
      "ecs": "/mcp/ecs",
      "oss": "/mcp/oss"
    }
  }
}
```

或者使用环境变量：

```bash
export OAUTH_CLIENT_ID=your_client_id
```

### 3. 启动服务

开发模式：
```bash
npm run dev
```

生产模式：
```bash
npm run build
npm start
```

### 4. 在 Claude Code 中配置

```bash
# 添加 MCP 服务器
claude mcp add --transport http aliyun-ecs http://localhost:3000/ecs/mcp

# 启动认证
/mcp
```

## 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `OAUTH_CLIENT_ID` | OAuth 客户端 ID | 必填 |
| `MCP_GATEWAY_PORT` | Gateway 监听端口 | 3000 |
| `OAUTH_AUTHORIZATION_ENDPOINT` | OAuth 授权端点 | `https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/authorize` |
| `OAUTH_TOKEN_ENDPOINT` | OAuth Token 端点 | `https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/token` |
| `OAUTH_SCOPE` | OAuth 权限范围 | `/acs/mcp-server` |
| `MCP_SERVER_BASE_URL` | MCP Server 基础 URL | `https://openapi-mcp-intl.vpc-proxy.aliyuncs.com` |
| `LOG_LEVEL` | 日志级别 | `info` |

### 配置文件

```json
{
  "port": 3000,
  "oauth": {
    "clientId": "your_client_id",
    "authorizationEndpoint": "https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/authorize",
    "tokenEndpoint": "https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/token",
    "scope": "/acs/mcp-server",
    "callbackPort": 3000
  },
  "mcpServer": {
    "baseUrl": "https://openapi-mcp-intl.vpc-proxy.aliyuncs.com",
    "services": {
      "ecs": "/mcp/ecs",
      "oss": "/mcp/oss",
      "rds": "/mcp/rds"
    }
  }
}
```

## API 端点

### MCP 代理

- `POST /:service/mcp` - MCP 请求代理
- `GET /:service/mcp` - MCP 资源请求

### OAuth

- `GET /oauth/authorize` - 启动 OAuth 授权流程
- `GET /oauth/callback` - OAuth 回调端点
- `GET /oauth/status` - 查看认证状态
- `POST /oauth/logout` - 登出

### 管理

- `GET /health` - 健康检查
- `GET /config/services` - 获取已配置的服务列表
- `POST /config/services` - 动态添加服务

## 多用户支持

通过 `X-User-ID` 请求头识别用户：

```bash
# 用户 A 的请求
curl -H "X-User-ID: user-a" http://localhost:3000/ecs/mcp

# 用户 B 的请求
curl -H "X-User-ID: user-b" http://localhost:3000/ecs/mcp
```

## OAuth 流程

1. 用户访问 `/oauth/authorize` 启动授权
2. Gateway 生成 PKCE 参数并重定向到阿里云授权页面
3. 用户登录并授权
4. 阿里云回调到 `/oauth/callback`
5. Gateway 用授权码换取 Token 并存储

## License

MIT