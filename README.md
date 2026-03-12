# Telegram API 通用代理 for Deno Deploy

生产级的 Telegram API 代理服务器，专为 Deno Deploy 设计，提供认证、速率限制、日志监控等企业级功能。

## 📋 特性

- **🔐 密码认证** - 可选的访问密码保护，支持 Cookie 登录
- **🚦 速率限制** - 基于客户端的请求限制，防止滥用
- **📊 监控指标** - 内置指标收集和可视化状态面板
- **🔄 自动重试** - 支持指数退避的请求重试机制
- **📝 详细日志** - 可配置的日志级别和请求/响应记录
- **🌐 CORS 支持** - 完整的跨域请求支持
- **🔧 高度可配置** - 所有功能均可通过环境变量配置

## 🚀 快速开始

### 部署到 Deno Deploy

1. **准备工作**
   - 注册 [Deno Deploy](https://deno.com/deploy) 账号
   - Fork 或复制本脚本到你的仓库

2. **创建项目**
   - 在 Deno Deploy 控制台创建新项目
   - 连接到你的 Git 仓库或直接上传脚本
   - 设置入口文件为 `telegram-api-proxy.ts`

3. **配置环境变量**
   - 在项目设置中添加所需的环境变量（见下方配置说明）

4. **部署完成**
   - 访问 `https://你的项目.deno.dev` 查看状态页面

### 本地运行

```bash
# 运行脚本
deno run --allow-net --allow-env telegram-api-proxy.ts

# 或使用环境变量
ACCESS_PASSWORD=your_password \
RATE_LIMIT_ENABLED=true \
deno run --allow-net --allow-env telegram-api-proxy.ts
```

## ⚙️ 配置说明

所有配置均通过环境变量设置：

| 环境变量 | 说明 | 默认值 | 可选值 |
|----------|------|--------|--------|
| **Telegram API 配置** |
| `TELEGRAM_API_BASE` | Telegram API 基础URL | `https://api.telegram.org` | 任意 Telegram API 地址 |
| **服务器配置** |
| `PROXY_HOST` | 监听地址 | `0.0.0.0` | IP 地址 |
| `PROXY_PORT` | 监听端口 | `8000` | 有效端口号 |
| **认证配置** |
| `ACCESS_PASSWORD` | 访问密码（空则禁用认证） | `""` | 任意字符串 |
| `COOKIE_MAX_AGE` | Cookie 有效期（秒） | `604800` (7天) | 正整数 |
| `COOKIE_NAME` | Cookie 名称 | `auth_token` | 字符串 |
| **请求限制** |
| `MAX_BODY_SIZE` | 最大请求体大小（字节） | `104857600` (100MB) | 正整数 |
| `REQUEST_TIMEOUT` | 请求超时（毫秒） | `30000` | 正整数 |
| **速率限制** |
| `RATE_LIMIT_ENABLED` | 启用速率限制 | `true` | `true`/`false` |
| `RATE_LIMIT_REQUESTS` | 窗口内最大请求数 | `100` | 正整数 |
| `RATE_LIMIT_WINDOW` | 时间窗口（毫秒） | `60000` (1分钟) | 正整数 |
| `RATE_LIMIT_CLEANUP_INTERVAL` | 清理间隔（毫秒） | `300000` (5分钟) | 正整数 |
| **重试机制** |
| `RETRY_ENABLED` | 启用重试 | `true` | `true`/`false` |
| `RETRY_MAX_ATTEMPTS` | 最大重试次数 | `3` | 正整数 |
| `RETRY_DELAY` | 初始延迟（毫秒） | `1000` | 正整数 |
| `RETRY_BACKOFF` | 指数退避倍数 | `2` | 大于1的浮点数 |
| **日志配置** |
| `LOG_ENABLED` | 启用日志 | `true` | `true`/`false` |
| `LOG_LEVEL` | 日志级别 | `info` | `debug`/`info`/`warn`/`error` |
| `LOG_REQUEST_BODY` | 记录请求体 | `false` | `true`/`false` |
| `LOG_RESPONSE_BODY` | 记录响应体 | `false` | `true`/`false` |
| **安全配置** |
| `SERVER_HEADER` | Server 响应头 | `nginx` | 字符串 |
| `ALLOWED_ORIGINS` | 允许的 CORS 源 | `*` | 逗号分隔的域名 |
| `HIDE_PROXY_HEADERS` | 隐藏代理相关头 | `true` | `true`/`false` |
| **监控配置** |
| `METRICS_ENABLED` | 启用指标收集 | `true` | `true`/`false` |
| `HEALTH_CHECK_PATH` | 健康检查路径 | `/health` | 路径字符串 |
| `METRICS_PATH` | 指标 API 路径 | `/metrics` | 路径字符串 |

## 📖 API 文档

### 代理 API

所有发送到根路径之外的请求都会被代理到 Telegram API。

**示例：**
```bash
# 原始 Telegram API 调用
curl https://api.telegram.org/bot{TOKEN}/getMe

# 通过代理调用
curl https://你的项目.deno.dev/bot{TOKEN}/getMe
```

### 认证 API

如果设置了 `ACCESS_PASSWORD`，需要先登录才能使用代理。

**登录：**
```bash
curl -X POST https://你的项目.deno.dev/auth \
  -H "Content-Type: application/json" \
  -d '{"password": "你的密码"}'
```

成功后会返回 Set-Cookie 头，后续请求会自动携带认证信息。

### 监控 API

#### 健康检查（无需认证）
```bash
curl https://你的项目.deno.dev/health
```

#### 详细指标（需要认证）
```bash
curl https://你的项目.deno.dev/metrics \
  -b "auth_token=你的token"
```

### WebSocket 支持

代理支持 WebSocket 连接，可用于调试和监控：

```javascript
const ws = new WebSocket('wss://你的项目.deno.dev');
ws.onmessage = (event) => console.log(event.data);
```

## 📊 状态页面

访问根路径 `/` 可查看可视化状态面板：

- 请求统计和错误率
- 延迟分析（P50/P95/P99）
- 速率限制状态
- 按路径和状态码的请求分布
- 系统配置信息

需要认证（如果设置了密码）。

## 🔧 高级用法

### 自定义 CORS

```bash
ALLOWED_ORIGINS="https://example.com,https://app.example.com"
```

### 调整速率限制

```bash
RATE_LIMIT_REQUESTS=200
RATE_LIMIT_WINDOW=300000  # 5分钟
```

### 详细调试日志

```bash
LOG_LEVEL=debug
LOG_REQUEST_BODY=true
LOG_RESPONSE_BODY=true
```

## 🛡️ 安全特性

1. **密码认证** - 防止未授权访问
2. **速率限制** - 防止 DoS 攻击
3. **请求体限制** - 防止超大请求
4. **头信息清理** - 隐藏代理指纹
5. **CORS 控制** - 限制允许的源
6. **安全响应头** - X-Content-Type-Options, X-Frame-Options 等

## 📝 日志格式

日志以 JSON 格式输出，包含：

```json
{
  "timestamp": "2024-01-01 00:00:00",
  "level": "INFO",
  "pid": 12345,
  "message": "Request completed",
  "data": {
    "ip": "127.0.0.1",
    "method": "GET",
    "path": "/botTOKEN/getMe",
    "status": 200,
    "duration": 123
  }
}
```

## 🔍 故障排查

### 常见问题

1. **认证失败**
   - 检查 `ACCESS_PASSWORD` 是否正确设置
   - 确认 Cookie 未过期
   - 验证 `/auth` 端点返回成功

2. **请求超时**
   - 增加 `REQUEST_TIMEOUT` 值
   - 检查网络连接
   - 确认 Telegram API 可访问

3. **速率限制**
   - 查看响应头中的 `X-RateLimit-*` 信息
   - 调整 `RATE_LIMIT_REQUESTS` 和 `RATE_LIMIT_WINDOW`

4. **日志不显示**
   - 确认 `LOG_ENABLED=true`
   - 检查 `LOG_LEVEL` 设置是否正确

### 性能优化

- 根据实际负载调整速率限制
- 监控 `/metrics` 端点了解系统状态
- 适当设置重试参数避免雪崩

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 支持

如有问题，请查看：
- [Telegram Bot API 文档](https://core.telegram.org/bots/api)
- [Deno Deploy 文档](https://deno.com/deploy/docs)
