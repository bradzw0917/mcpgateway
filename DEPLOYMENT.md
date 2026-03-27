# MCP Gateway 部署文档

## 目录

1. [环境要求](#环境要求)
2. [快速部署](#快速部署)
3. [详细步骤](#详细步骤)
4. [生产环境部署](#生产环境部署)
5. [Nginx 反向代理](#nginx-反向代理)
6. [常见问题](#常见问题)

---

## 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Linux (Ubuntu 20.04+, CentOS 7+, Debian 10+) |
| Node.js | 18.0.0 或更高版本 |
| 内存 | 最低 512MB |
| 磁盘 | 最低 100MB |
| 网络 | 可访问阿里云国际站 API |

---

## 快速部署

```bash
# 1. 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 克隆代码
git clone https://github.com/bradzw0917/mcpgateway.git
cd mcpgateway

# 3. 安装依赖
npm install

# 4. 配置 OAuth Client ID
export OAUTH_CLIENT_ID=your_client_id

# 5. 配置 MCP 服务 (可选)
cat > config.json << EOF
{
  "port": 3000,
  "oauth": {
    "clientId": "your_client_id"
  },
  "mcpServer": {
    "services": {
      "ecs": "/mcp/ecs",
      "oss": "/mcp/oss"
    }
  }
}
EOF

# 6. 构建并启动
npm run build
npm start
```

---

## 详细步骤

### 1. 安装 Node.js

#### Ubuntu/Debian

```bash
# 安装 Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version  # 应输出 v18.x.x
npm --version   # 应输出 9.x.x 或更高
```

#### CentOS/RHEL/Rocky Linux

```bash
# 安装 Node.js 18.x
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# 验证安装
node --version
npm --version
```

#### 使用 nvm 安装 (推荐)

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc

# 安装 Node.js 18
nvm install 18
nvm use 18

# 验证
node --version
```

### 2. 克隆代码

```bash
# 安装 git (如果没有)
sudo apt-get install -y git  # Ubuntu/Debian
# sudo yum install -y git    # CentOS/RHEL

# 克隆仓库
git clone https://github.com/bradzw0917/mcpgateway.git
cd mcpgateway
```

### 3. 安装依赖

```bash
npm install
```

### 4. 配置

#### 方式一: 环境变量 (推荐用于快速测试)

```bash
# 必需配置
export OAUTH_CLIENT_ID=your_client_id

# 可选配置
export MCP_GATEWAY_PORT=3000
export OAUTH_SCOPE=/acs/mcp-server
export MCP_SERVER_BASE_URL=https://openapi-mcp-intl.vpc-proxy.aliyuncs.com
```

#### 方式二: 配置文件 (推荐用于生产环境)

```bash
cp config.example.json config.json
```

编辑 `config.json`:

```json
{
  "port": 3000,
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

### 5. 构建和启动

```bash
# 构建 TypeScript
npm run build

# 启动服务
npm start

# 或开发模式 (带热重载)
npm run dev
```

### 6. 验证部署

```bash
# 健康检查
curl http://localhost:3000/health

# 预期输出
# {"status":"ok","timestamp":"2024-...","version":"1.0.0"}
```

---

## 生产环境部署

### 使用 PM2 进程管理 (推荐)

#### 1. 安装 PM2

```bash
sudo npm install -g pm2
```

#### 2. 创建 PM2 配置文件

```bash
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'mcp-gateway',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      OAUTH_CLIENT_ID: 'your_client_id',
    }
  }]
};
EOF
```

#### 3. 启动服务

```bash
# 构建应用
npm run build

# 启动
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs mcp-gateway
```

#### 4. 设置开机自启

```bash
# 生成启动脚本
pm2 startup

# 按照提示执行输出的命令，例如:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u username --hp /home/username

# 保存当前进程列表
pm2 save
```

#### 5. PM2 常用命令

```bash
pm2 status              # 查看状态
pm2 logs mcp-gateway    # 查看日志
pm2 restart mcp-gateway # 重启服务
pm2 stop mcp-gateway    # 停止服务
pm2 delete mcp-gateway  # 删除服务
pm2 monit               # 实时监控
```

### 使用 systemd 服务

#### 1. 创建服务文件

```bash
sudo cat > /etc/systemd/system/mcp-gateway.service << 'EOF'
[Unit]
Description=MCP Gateway Service
After=network.target

[Service]
Type=simple
User=ecs-user
WorkingDirectory=/home/ecs-user/mcpgateway
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=mcp-gateway
Environment=NODE_ENV=production
Environment=OAUTH_CLIENT_ID=your_client_id

[Install]
WantedBy=multi-user.target
EOF
```

#### 2. 启用并启动服务

```bash
# 重载 systemd
sudo systemctl daemon-reload

# 启用开机自启
sudo systemctl enable mcp-gateway

# 启动服务
sudo systemctl start mcp-gateway

# 查看状态
sudo systemctl status mcp-gateway

# 查看日志
sudo journalctl -u mcp-gateway -f
```

---

## Nginx 反向代理

如果需要通过域名访问或配置 HTTPS，可以使用 Nginx 反向代理。

### 1. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt-get install -y nginx

# CentOS/RHEL
sudo yum install -y nginx
```

### 2. 创建 Nginx 配置

```bash
sudo cat > /etc/nginx/sites-available/mcp-gateway << 'EOF'
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# 启用配置
sudo ln -s /etc/nginx/sites-available/mcp-gateway /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

### 3. 配置 HTTPS (使用 Let's Encrypt)

```bash
# 安装 Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期测试
sudo certbot renew --dry-run
```

---

## 防火墙配置

### Ubuntu (UFW)

```bash
# 允许端口
sudo ufw allow 3000/tcp

# 如果使用 Nginx
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 启用防火墙
sudo ufw enable
```

### CentOS (firewalld)

```bash
# 允许端口
sudo firewall-cmd --permanent --add-port=3000/tcp

# 如果使用 Nginx
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# 重载防火墙
sudo firewall-cmd --reload
```

### 云服务器安全组

如果部署在云服务器上，需要在安全组中开放相应端口：
- 3000 (MCP Gateway)
- 80 (HTTP)
- 443 (HTTPS)

---

## 更新部署

```bash
cd /home/ecs-user/mcpgateway

# 拉取最新代码
git pull origin main

# 安装新依赖
npm install

# 重新构建
npm run build

# 重启服务
# PM2 方式
pm2 restart mcp-gateway

# systemd 方式
sudo systemctl restart mcp-gateway
```

---

## 常见问题

### Q: 启动报错 "OAuth clientId is required"

确保设置了 `OAUTH_CLIENT_ID` 环境变量或在 `config.json` 中配置了 `clientId`。

```bash
export OAUTH_CLIENT_ID=your_client_id
```

### Q: 无法访问阿里云 API

检查服务器网络是否能访问阿里云国际站：

```bash
curl -I https://openapi-mcp-intl.vpc-proxy.aliyuncs.com
curl -I https://oauth-intl.vpc-proxy.aliyuncs.com
```

### Q: OAuth 回调失败

确保：
1. OAuth 回调地址已在阿里云 OAuth 应用中注册
2. 回调地址格式为 `http://your-host:port/oauth/callback`
3. 如果有防火墙/安全组，确保端口已开放

### Q: 端口被占用

```bash
# 查看端口占用
sudo lsof -i :3000

# 杀死进程
sudo kill -9 <PID>

# 或更换端口
export MCP_GATEWAY_PORT=3001
```

### Q: Node.js 版本过低

```bash
# 使用 nvm 安装新版本
nvm install 18
nvm use 18
nvm alias default 18
```

---

## 部署检查清单

- [ ] Node.js 18+ 已安装
- [ ] 代码已克隆
- [ ] 依赖已安装 (`npm install`)
- [ ] OAuth Client ID 已配置
- [ ] MCP 服务路径已配置
- [ ] 服务已启动并可通过健康检查
- [ ] 防火墙/安全组端口已开放
- [ ] (可选) PM2/systemd 服务已配置
- [ ] (可选) Nginx 反向代理已配置
- [ ] (可选) HTTPS 证书已配置