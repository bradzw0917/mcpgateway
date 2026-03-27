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

**重要**: 必须使用 `--client-id` 参数，因为阿里云 OAuth 不支持动态客户端注册。

**本机部署**：
```bash
# --client-id 可以是任意值，Gateway 会使用预配置的 Client ID
claude mcp add --transport http --client-id mcp-gateway aliyun-ecs http://localhost:3000/ecs/mcp
```

**远程部署**（Gateway 在另一台服务器）：
```bash
# 使用服务器 IP
claude mcp add --transport http --client-id mcp-gateway aliyun-ecs http://YOUR_SERVER_IP:3000/ecs/mcp

# 或使用域名
claude mcp add --transport http --client-id mcp-gateway aliyun-ecs https://gateway.yourdomain.com/ecs/mcp
```

### 5. 完成 OAuth 认证

```bash
# 在 Claude Code 中执行 /mcp，选择对应的服务器进行认证
/mcp

# 选择 "Authenticate"，浏览器会自动打开阿里云授权页面
# 授权成功后会自动返回
```

## 远程部署配置

当 Claude Code 和 Gateway 不在同一台机器上时，需要进行额外配置：

### 1. 配置 Gateway 的公网地址

设置 `GATEWAY_BASE_URL` 环境变量：

```bash
# 使用 IP
export GATEWAY_BASE_URL=http://YOUR_SERVER_IP:3000

# 或使用域名
export GATEWAY_BASE_URL=https://gateway.yourdomain.com
```

### 2. 配置阿里云 OAuth 回调地址

在阿里云 RAM 控制台的 OAuth 应用配置中，添加回调地址：

```
http://YOUR_SERVER_IP:3000/oauth/callback
```

或使用域名：

```
https://gateway.yourdomain.com/oauth/callback
```

### 3. 开放防火墙端口

确保服务器的 3000 端口（或你配置的端口）对外开放。

### 4. 配置示例

**服务器端**：
```bash
# 设置环境变量
export OAUTH_CLIENT_ID=your_client_id
export GATEWAY_BASE_URL=http://123.45.67.89:3000

# 启动服务
npm run build && npm start
```

**客户端 (Claude Code)**：
```bash
claude mcp add --transport http aliyun-ecs http://123.45.67.89:3000/ecs/mcp
```

**阿里云 OAuth 配置**：
- 回调地址: `http://123.45.67.89:3000/oauth/callback`

## 配置说明

配置有三个优先级层级（从高到低）：

1. **环境变量** - 最高优先级
2. **config.json 文件**
3. **默认值**

### 配置文件 (config.json)

```json
{
  "port": 3000,
  "gatewayBaseUrl": "http://YOUR_SERVER_IP:3000",

  "oauth": {
    "clientId": "your_client_id",
    "authorizationEndpoint": "https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/authorize",
    "tokenEndpoint": "https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/token",
    "scope": "/acs/mcp-server"
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

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `OAUTH_CLIENT_ID` | OAuth 客户端 ID | 必填 |
| `GATEWAY_BASE_URL` | Gateway 的公网访问地址（用于 OAuth 回调） | 自动检测 |
| `MCP_GATEWAY_PORT` | Gateway 监听端口 | 3000 |
| `OAUTH_AUTHORIZATION_ENDPOINT` | OAuth 授权端点 | `https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/authorize` |
| `OAUTH_TOKEN_ENDPOINT` | OAuth Token 端点 | `https://oauth-intl.vpc-proxy.aliyuncs.com/oauth2/token` |
| `OAUTH_SCOPE` | OAuth 权限范围 | `/acs/mcp-server` |
| `MCP_SERVER_BASE_URL` | MCP Server 基础 URL | `https://openapi-mcp-intl.vpc-proxy.aliyuncs.com` |
| `LOG_LEVEL` | 日志级别 | `info` |

### 配置项说明

| 配置项 | 说明 | 是否必填 |
|--------|------|----------|
| `port` | Gateway 监听端口 | 否，默认 3000 |
| `gatewayBaseUrl` | Gateway 的公网访问地址，用于生成 OAuth 回调 URL | 远程部署时必填 |
| `oauth.clientId` | 阿里云 OAuth 应用的 Client ID | **必填** |
| `oauth.authorizationEndpoint` | 阿里云 OAuth 授权端点 | 否 |
| `oauth.tokenEndpoint` | 阿里云 OAuth Token 端点 | 否 |
| `oauth.scope` | OAuth 权限范围 | 否 |
| `mcpServer.baseUrl` | 阿里云 MCP Server 基础 URL | 否 |
| `mcpServer.services` | MCP 服务路径映射，key 是别名，value 是路径 | 否 |

## API 端点

### MCP 代理

- `POST /:service/mcp` - MCP 请求代理
- `GET /:service/mcp` - MCP 资源请求

### OAuth

- `GET /.well-known/oauth-authorization-server` - OAuth 元数据发现
- `GET /oauth/authorize` - 启动 OAuth 授权流程
- `GET /oauth/callback` - OAuth 回调端点
- `POST /oauth/token` - Token 端点
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

1. Claude Code 检测到需要 OAuth 认证
2. 打开浏览器访问 `/oauth/authorize`
3. Gateway 重定向到阿里云授权页面
4. 用户登录并授权
5. 阿里云回调到 `/oauth/callback`
6. Gateway 用授权码换取 Token 并存储
7. 重定向回 Claude Code 完成认证

## License

MIT