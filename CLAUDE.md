# MCP Gateway Project

## 自动推送规则

每次创建 git commit 后，自动执行 `git push` 推送到远程仓库。

## 项目说明

MCP Gateway 是一个代理服务，用于连接 Claude Code 和阿里云国际站 OpenAPI MCP Server。

### 核心功能
- MCP 请求代理
- OAuth 2.1 + PKCE 认证
- 多用户支持

### 启动方式
```bash
# 开发模式
npm run dev

# 生产模式
npm run build && npm start
```

### 配置
设置环境变量 `OAUTH_CLIENT_ID` 或创建 `config.json` 文件。