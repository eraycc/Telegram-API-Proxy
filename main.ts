// telegram-api-proxy.ts
// 生产级 Telegram API 通用代理 for Deno Deploy

// ==================== 配置管理 ====================
interface Config {
  // Telegram API 配置
  telegramApiBase: string;
  
  // 代理配置
  proxyHost: string;
  proxyPort: number;
  
  // 安全路径配置（可选）
  securePath: string;
  
  // 密码验证（用于首页）
  accessPassword: string;
  cookieMaxAge: number;
  cookieName: string;
  
  // 请求限制
  maxBodySize: number;
  requestTimeout: number;
  
  // 速率限制
  rateLimitEnabled: boolean;
  rateLimitRequests: number;
  rateLimitWindow: number;
  rateLimitCleanupInterval: number;
  
  // 重试机制
  retryEnabled: boolean;
  retryMaxAttempts: number;
  retryDelay: number;
  retryBackoff: number;
  
  // 日志配置
  logEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logRequestBody: boolean;
  logResponseBody: boolean;
  
  // 安全配置
  serverHeader: string;
  allowedOrigins: string[];
  hideProxyHeaders: boolean;
  
  // 监控配置
  metricsEnabled: boolean;
  healthCheckPath: string;
  metricsPath: string;
}

// 从环境变量加载配置
function loadConfig(): Config {
  const securePath = Deno.env.get("SECURE_PATH") || "";
  
  return {
    // Telegram API 配置
    telegramApiBase: Deno.env.get("TELEGRAM_API_BASE") || "https://api.telegram.org",
    
    // 代理配置
    proxyHost: Deno.env.get("PROXY_HOST") || "0.0.0.0",
    proxyPort: parseInt(Deno.env.get("PROXY_PORT") || "8000"),
    
    // 安全路径配置
    securePath: securePath ? `/${securePath.replace(/^\//, '')}` : "",
    
    // 密码验证
    accessPassword: Deno.env.get("ACCESS_PASSWORD") || "",
    cookieMaxAge: parseInt(Deno.env.get("COOKIE_MAX_AGE") || "604800"), // 7天
    cookieName: Deno.env.get("COOKIE_NAME") || "auth_token",
    
    // 请求限制
    maxBodySize: parseInt(Deno.env.get("MAX_BODY_SIZE") || "104857600"), // 100MB
    requestTimeout: parseInt(Deno.env.get("REQUEST_TIMEOUT") || "30000"), // 30秒
    
    // 速率限制
    rateLimitEnabled: Deno.env.get("RATE_LIMIT_ENABLED") !== "false",
    rateLimitRequests: parseInt(Deno.env.get("RATE_LIMIT_REQUESTS") || "100"),
    rateLimitWindow: parseInt(Deno.env.get("RATE_LIMIT_WINDOW") || "60000"), // 1分钟
    rateLimitCleanupInterval: parseInt(Deno.env.get("RATE_LIMIT_CLEANUP_INTERVAL") || "300000"), // 5分钟
    
    // 重试机制
    retryEnabled: Deno.env.get("RETRY_ENABLED") !== "false",
    retryMaxAttempts: parseInt(Deno.env.get("RETRY_MAX_ATTEMPTS") || "3"),
    retryDelay: parseInt(Deno.env.get("RETRY_DELAY") || "1000"), // 1秒
    retryBackoff: parseFloat(Deno.env.get("RETRY_BACKOFF") || "2"), // 指数退避倍数
    
    // 日志配置
    logEnabled: Deno.env.get("LOG_ENABLED") !== "false",
    logLevel: (Deno.env.get("LOG_LEVEL") as Config['logLevel']) || "info",
    logRequestBody: Deno.env.get("LOG_REQUEST_BODY") === "true",
    logResponseBody: Deno.env.get("LOG_RESPONSE_BODY") === "true",
    
    // 安全配置
    serverHeader: Deno.env.get("SERVER_HEADER") || "nginx",
    allowedOrigins: Deno.env.get("ALLOWED_ORIGINS")?.split(",") || ["*"],
    hideProxyHeaders: Deno.env.get("HIDE_PROXY_HEADERS") !== "false",
    
    // 监控配置
    metricsEnabled: Deno.env.get("METRICS_ENABLED") !== "false",
    healthCheckPath: Deno.env.get("HEALTH_CHECK_PATH") || "/health",
    metricsPath: Deno.env.get("METRICS_PATH") || "/metrics",
  };
}

const CONFIG = loadConfig();

// ==================== 密码验证工具 ====================
function validatePassword(password: string): boolean {
  if (!CONFIG.accessPassword) {
    return true;
  }
  return password === CONFIG.accessPassword;
}

function generateAuthCookie(): string {
  const token = btoa(`${CONFIG.accessPassword}:${Date.now()}`);
  return token;
}

function validateAuthCookie(cookieValue: string | null): boolean {
  if (!CONFIG.accessPassword) {
    return true;
  }
  
  if (!cookieValue) return false;
  
  try {
    const decoded = atob(cookieValue);
    const [password] = decoded.split(':');
    return password === CONFIG.accessPassword;
  } catch {
    return false;
  }
}

// ==================== 日志系统 ====================
class Logger {
  private enabled: boolean;
  private level: number;
  private logRequestBody: boolean;
  private logResponseBody: boolean;

  private levelMap = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: Config) {
    this.enabled = config.logEnabled;
    this.level = this.levelMap[config.logLevel];
    this.logRequestBody = config.logRequestBody;
    this.logResponseBody = config.logResponseBody;
  }

  private getBeijingTime(): string {
    const date = new Date();
    date.setHours(date.getHours() + 8);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }

  private formatLog(level: string, message: string, data?: any): string {
    const timestamp = this.getBeijingTime();
    const pid = Deno.pid;
    const logEntry: any = {
      timestamp,
      level,
      pid,
      message,
    };

    if (data) {
      if (data.body && typeof data.body === 'string' && data.body.length > 1000) {
        data.body = data.body.substring(0, 1000) + '... [truncated]';
      }
      logEntry.data = data;
    }

    return JSON.stringify(logEntry);
  }

  debug(message: string, data?: any) {
    if (this.enabled && this.level <= 0) {
      console.debug(this.formatLog('DEBUG', message, data));
    }
  }

  info(message: string, data?: any) {
    if (this.enabled && this.level <= 1) {
      console.info(this.formatLog('INFO', message, data));
    }
  }

  warn(message: string, data?: any) {
    if (this.enabled && this.level <= 2) {
      console.warn(this.formatLog('WARN', message, data));
    }
  }

  error(message: string, data?: any) {
    if (this.enabled && this.level <= 3) {
      console.error(this.formatLog('ERROR', message, data));
    }
  }

  async logRequest(req: Request, startTime: number, response?: Response, error?: Error) {
    if (!this.enabled) return;

    const url = new URL(req.url);
    const clientIp = req.headers.get("cf-connecting-ip") || 
                    req.headers.get("x-forwarded-for")?.split(",")[0].trim() || 
                    "unknown";
    
    const logData: any = {
      ip: clientIp,
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      ua: req.headers.get("user-agent") || "unknown",
      duration: Date.now() - startTime,
    };

    if (this.logRequestBody && req.body && req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        const clonedReq = req.clone();
        const body = await clonedReq.text();
        if (body) {
          try {
            logData.body = JSON.parse(body);
          } catch {
            logData.body = body.substring(0, 500);
          }
        }
      } catch (e) {
        logData.bodyError = 'Failed to read body';
      }
    }

    if (error) {
      logData.error = {
        message: error.message,
        stack: error.stack,
      };
      this.error('Request failed', logData);
    } else if (response) {
      logData.status = response.status;
      logData.statusText = response.statusText;
      
      if (this.logResponseBody && response.body) {
        try {
          const clonedRes = response.clone();
          const body = await clonedRes.text();
          if (body) {
            try {
              logData.responseBody = JSON.parse(body);
            } catch {
              logData.responseBody = body.substring(0, 500);
            }
          }
        } catch (e) {
          logData.responseBodyError = 'Failed to read response body';
        }
      }
      
      if (response.status >= 400) {
        this.warn('Request completed with error status', logData);
      } else {
        this.info('Request completed', logData);
      }
    } else {
      this.debug('Request started', logData);
    }
  }
}

const logger = new Logger(CONFIG);

// ==================== 速率限制器 ====================
class RateLimiter {
  private limits: Map<string, { count: number; resetTime: number }>;
  private cleanupInterval: number;
  private maxRequests: number;
  private window: number;
  private enabled: boolean;

  constructor(maxRequests: number, window: number, cleanupInterval: number, enabled: boolean) {
    this.limits = new Map();
    this.maxRequests = maxRequests;
    this.window = window;
    this.cleanupInterval = cleanupInterval;
    this.enabled = enabled;
    
    if (this.enabled) {
      this.startCleanup();
    }
  }

  private startCleanup() {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, value] of this.limits.entries()) {
        if (now > value.resetTime) {
          this.limits.delete(key);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        logger.debug(`Rate limiter cleanup: removed ${cleaned} expired entries`);
      }
    }, this.cleanupInterval);
  }

  async check(clientId: string): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    if (!this.enabled) {
      return { allowed: true, remaining: Infinity, resetTime: 0 };
    }

    const now = Date.now();
    const limit = this.limits.get(clientId);

    if (!limit || now > limit.resetTime) {
      this.limits.set(clientId, {
        count: 1,
        resetTime: now + this.window,
      });
      return { 
        allowed: true, 
        remaining: this.maxRequests - 1,
        resetTime: now + this.window 
      };
    }

    if (limit.count >= this.maxRequests) {
      return { 
        allowed: false, 
        remaining: 0,
        resetTime: limit.resetTime 
      };
    }

    limit.count++;
    return { 
      allowed: true, 
      remaining: this.maxRequests - limit.count,
      resetTime: limit.resetTime 
    };
  }

  getStats() {
    return {
      totalEntries: this.limits.size,
      maxRequests: this.maxRequests,
      window: this.window,
    };
  }
}

const rateLimiter = new RateLimiter(
  CONFIG.rateLimitRequests,
  CONFIG.rateLimitWindow,
  CONFIG.rateLimitCleanupInterval,
  CONFIG.rateLimitEnabled
);

// ==================== 指标收集器 ====================
class MetricsCollector {
  private metrics: {
    requestsTotal: number;
    requestsByMethod: Map<string, number>;
    requestsByPath: Map<string, number>;
    requestsByStatus: Map<number, number>;
    bytesTransferred: number;
    errorsTotal: number;
    activeConnections: number;
    responseTimes: number[];
    lastResetTime: number;
  };

  private maxResponseTimeSamples = 1000;
  private enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
    this.reset();
  }

  private reset() {
    this.metrics = {
      requestsTotal: 0,
      requestsByMethod: new Map(),
      requestsByPath: new Map(),
      requestsByStatus: new Map(),
      bytesTransferred: 0,
      errorsTotal: 0,
      activeConnections: 0,
      responseTimes: [],
      lastResetTime: Date.now(),
    };
  }

  incrementActive() {
    if (!this.enabled) return;
    this.metrics.activeConnections++;
  }

  decrementActive() {
    if (!this.enabled) return;
    this.metrics.activeConnections--;
  }

  recordRequest(method: string, path: string, status: number, duration: number, bytes?: number) {
    if (!this.enabled) return;

    this.metrics.requestsTotal++;
    this.metrics.requestsByMethod.set(
      method, 
      (this.metrics.requestsByMethod.get(method) || 0) + 1
    );
    
    const pathParts = path.split('/').filter(p => p);
    const pathKey = pathParts.length > 2 ? `/${pathParts[0]}/${pathParts[1]}/*` : path;
    this.metrics.requestsByPath.set(
      pathKey,
      (this.metrics.requestsByPath.get(pathKey) || 0) + 1
    );
    
    this.metrics.requestsByStatus.set(
      status,
      (this.metrics.requestsByStatus.get(status) || 0) + 1
    );

    if (status >= 400) {
      this.metrics.errorsTotal++;
    }

    if (bytes) {
      this.metrics.bytesTransferred += bytes;
    }

    this.metrics.responseTimes.push(duration);
    if (this.metrics.responseTimes.length > this.maxResponseTimeSamples) {
      this.metrics.responseTimes.shift();
    }
  }

  getStats() {
    const now = Date.now();
    const uptime = now - this.metrics.lastResetTime;
    
    const sortedTimes = [...this.metrics.responseTimes].sort((a, b) => a - b);
    const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0;
    const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0;
    const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0;

    return {
      uptime,
      requests: {
        total: this.metrics.requestsTotal,
        byMethod: Object.fromEntries(this.metrics.requestsByMethod),
        byPath: Object.fromEntries(this.metrics.requestsByPath),
        byStatus: Object.fromEntries(this.metrics.requestsByStatus),
      },
      errors: {
        total: this.metrics.errorsTotal,
        rate: this.metrics.requestsTotal > 0 
          ? (this.metrics.errorsTotal / this.metrics.requestsTotal * 100).toFixed(2) + '%'
          : '0%',
      },
      throughput: {
        bytesTransferred: this.metrics.bytesTransferred,
        requestsPerSecond: uptime > 0 
          ? (this.metrics.requestsTotal / (uptime / 1000)).toFixed(2)
          : 0,
      },
      connections: {
        active: this.metrics.activeConnections,
      },
      latency: {
        p50: p50,
        p95: p95,
        p99: p99,
        samples: this.metrics.responseTimes.length,
      },
      rateLimiter: rateLimiter.getStats(),
      timestamp: new Date().toISOString(),
    };
  }

  resetStats() {
    this.reset();
  }
}

const metrics = new MetricsCollector(CONFIG.metricsEnabled);

// ==================== 工具函数 ====================

async function getClientId(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") || 
             req.headers.get("x-forwarded-for")?.split(",")[0].trim() || 
             "unknown";
  const ua = req.headers.get("user-agent") || "";
  const acceptLang = req.headers.get("accept-language")?.split(",")[0] || "";
  
  const components = [ip, ua, acceptLang];
  const data = new TextEncoder().encode(components.join("|"));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function cleanRequestHeaders(headers: Headers): Headers {
  if (!CONFIG.hideProxyHeaders) {
    return headers;
  }

  const cleaned = new Headers();
  const headersToRemove = new Set([
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-server",
    "x-real-ip",
    "x-deno-deployment-id",
    "x-deno-region",
    "x-deno-subhost",
    "via",
    "forwarded",
    "cookie",
    "authorization",
  ]);

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    
    if (headersToRemove.has(lowerKey)) return;
    if (lowerKey.startsWith("x-deno-")) return;
    
    if (lowerKey === "host") {
      cleaned.set("Host", "api.telegram.org");
      return;
    }
    
    cleaned.set(key, value);
  });

  return cleaned;
}

function cleanResponseHeaders(headers: Headers): Headers {
  if (!CONFIG.hideProxyHeaders) {
    return headers;
  }

  const cleaned = new Headers();
  const headersToRemove = new Set([
    "x-deno-deployment-id",
    "x-deno-region",
    "server",
    "via",
    "set-cookie",
  ]);

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    
    if (headersToRemove.has(lowerKey)) return;
    if (lowerKey.startsWith("x-deno-")) return;
    
    cleaned.set(key, value);
  });

  cleaned.set("Server", CONFIG.serverHeader);
  
  return cleaned;
}

function getCorsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": CONFIG.allowedOrigins.includes("*") ? "*" : CONFIG.allowedOrigins.join(", "),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  };
}

async function fetchWithRetry(url: string, options: RequestInit, attempt: number = 1): Promise<Response> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeout);
    
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    if (!CONFIG.retryEnabled || attempt >= CONFIG.retryMaxAttempts) {
      throw error;
    }

    const delay = CONFIG.retryDelay * Math.pow(CONFIG.retryBackoff, attempt - 1);
    logger.warn(`Request failed, retrying (${attempt}/${CONFIG.retryMaxAttempts}) after ${delay}ms`, {
      url,
      error: error.message,
    });

    await new Promise(resolve => setTimeout(resolve, delay));
    return fetchWithRetry(url, options, attempt + 1);
  }
}

// ==================== WebSocket 处理 ====================
async function handleWebSocket(req: Request): Promise<Response> {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  try {
    const { socket: clientSocket, response } = Deno.upgradeWebSocket(req);
    
    logger.info('WebSocket connection attempt', {
      url: req.url,
    });

    clientSocket.onopen = () => {
      logger.debug('WebSocket connection opened');
      clientSocket.send(JSON.stringify({
        type: 'info',
        message: 'Connected',
        timestamp: new Date().toISOString(),
      }));
    };

    clientSocket.onmessage = (event) => {
      logger.debug('WebSocket message received', {
        data: event.data.substring(0, 200),
      });
      
      clientSocket.send(JSON.stringify({
        type: 'echo',
        data: event.data,
        timestamp: new Date().toISOString(),
      }));
    };

    clientSocket.onerror = (error) => {
      logger.error('WebSocket error', { error });
    };

    clientSocket.onclose = () => {
      logger.debug('WebSocket connection closed');
    };

    return response;
  } catch (error) {
    logger.error('WebSocket upgrade failed', { error: error.message });
    return new Response('WebSocket upgrade failed', { status: 500 });
  }
}

// ==================== 登录页面 ====================
function renderLoginPage(error?: string): string {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>系统登录</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .login-container {
            width: 100%;
            max-width: 400px;
        }
        
        .login-card {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            animation: slideUp 0.5s ease-out;
        }
        
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .login-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px 30px;
            text-align: center;
            color: white;
        }
        
        .login-header h1 {
            font-size: 28px;
            font-weight: 600;
            margin-bottom: 10px;
        }
        
        .login-header p {
            opacity: 0.9;
            font-size: 14px;
        }
        
        .login-form {
            padding: 40px 30px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 500;
            font-size: 14px;
        }
        
        .form-group input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s;
            outline: none;
        }
        
        .form-group input:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        .form-group input.error {
            border-color: #f44336;
        }
        
        .error-message {
            color: #f44336;
            font-size: 13px;
            margin-top: 5px;
            display: ${error ? 'block' : 'none'};
            animation: shake 0.5s;
        }
        
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
            20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        
        .login-button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }
        
        .login-button:active {
            transform: translateY(0);
        }
        
        .login-footer {
            text-align: center;
            margin-top: 20px;
            color: #666;
            font-size: 13px;
        }
        
        .login-footer a {
            color: #667eea;
            text-decoration: none;
        }
        
        .login-footer a:hover {
            text-decoration: underline;
        }
        
        .loading {
            display: none;
            text-align: center;
            margin-top: 20px;
        }
        
        .loading.show {
            display: block;
        }
        
        .spinner {
            width: 40px;
            height: 40px;
            margin: 0 auto;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-card">
            <div class="login-header">
                <h1>🔐 系统登录</h1>
                <p>请输入访问密码以继续</p>
            </div>
            
            <div class="login-form">
                <form id="loginForm" onsubmit="handleSubmit(event)">
                    <div class="form-group">
                        <label for="password">访问密码</label>
                        <input 
                            type="password" 
                            id="password" 
                            name="password" 
                            placeholder="请输入密码"
                            class="${error ? 'error' : ''}"
                            autofocus
                        >
                        <div class="error-message" id="errorMessage">
                            ${error || '密码错误，请重试'}
                        </div>
                    </div>
                    
                    <button type="submit" class="login-button" id="submitBtn">
                        登录系统
                    </button>
                </form>
                
                <div class="loading" id="loading">
                    <div class="spinner"></div>
                    <p style="margin-top: 10px; color: #666;">验证中...</p>
                </div>
                
                <div class="login-footer">
                    <p>© 2024 系统管理面板</p>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        async function handleSubmit(event) {
            event.preventDefault();
            
            const password = document.getElementById('password').value;
            const submitBtn = document.getElementById('submitBtn');
            const loading = document.getElementById('loading');
            const errorMessage = document.getElementById('errorMessage');
            
            if (!password) {
                errorMessage.style.display = 'block';
                errorMessage.textContent = '请输入密码';
                return;
            }
            
            submitBtn.disabled = true;
            loading.classList.add('show');
            errorMessage.style.display = 'none';
            
            try {
                const response = await fetch('/auth', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ password }),
                });
                
                const data = await response.json();
                
                if (data.success) {
                    window.location.reload();
                } else {
                    errorMessage.style.display = 'block';
                    errorMessage.textContent = data.message || '密码错误';
                    document.getElementById('password').classList.add('error');
                }
            } catch (error) {
                errorMessage.style.display = 'block';
                errorMessage.textContent = '登录失败，请重试';
            } finally {
                submitBtn.disabled = false;
                loading.classList.remove('show');
            }
        }
        
        document.getElementById('password').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                handleSubmit(e);
            }
        });
    </script>
</body>
</html>
  `;
}

// ==================== 状态页面 ====================
function renderStatusPage(): string {
  const stats = metrics.getStats();
  const beijingTime = new Date();
  beijingTime.setHours(beijingTime.getHours() + 8);

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>系统状态</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
        }
        
        .navbar {
            background: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 15px 0;
        }
        
        .navbar-content {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .navbar-brand {
            font-size: 20px;
            font-weight: 600;
            color: #333;
            text-decoration: none;
        }
        
        .navbar-brand span {
            color: #667eea;
        }
        
        .logout-btn {
            padding: 8px 16px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s;
        }
        
        .logout-btn:hover {
            background: #d32f2f;
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(244, 67, 54, 0.3);
        }
        
        .container {
            max-width: 1200px;
            margin: 30px auto;
            padding: 0 20px;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            border-radius: 10px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);
        }
        
        .header h1 {
            margin: 0;
            font-size: 2.5em;
            font-weight: 600;
        }
        
        .header p {
            margin: 10px 0 0;
            opacity: 0.9;
        }
        
        .status-badge {
            display: inline-block;
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: bold;
            margin-left: 10px;
        }
        
        .status-healthy {
            background: #10b981;
            color: white;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .card {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: all 0.3s;
        }
        
        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.1);
        }
        
        .card h2 {
            margin: 0 0 15px;
            font-size: 1.2em;
            color: #666;
            border-bottom: 2px solid #f0f0f0;
            padding-bottom: 10px;
        }
        
        .metric {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        
        .metric:last-child {
            border-bottom: none;
        }
        
        .metric-label {
            color: #666;
        }
        
        .metric-value {
            font-weight: bold;
            color: #333;
        }
        
        .metric-value.warning {
            color: #f59e0b;
        }
        
        .metric-value.error {
            color: #ef4444;
        }
        
        .metric-value.success {
            color: #10b981;
        }
        
        .table-container {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow-x: auto;
            margin-bottom: 20px;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        th {
            background: #f8f9fa;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            color: #666;
        }
        
        td {
            padding: 12px;
            border-bottom: 1px solid #f0f0f0;
        }
        
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 0.9em;
        }
        
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #f0f0f0;
            border-radius: 4px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea, #764ba2);
            transition: width 0.3s ease;
        }
        
        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 0.8em;
            font-weight: 500;
        }
        
        .badge-success {
            background: #d1fae5;
            color: #065f46;
        }
        
        .badge-warning {
            background: #fef3c7;
            color: #92400e;
        }
        
        .badge-error {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .badge-info {
            background: #e0f2fe;
            color: #0369a1;
        }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="navbar-content">
            <a href="/" class="navbar-brand">
                <span>📊</span> 系统监控
            </a>
            <button class="logout-btn" onclick="handleLogout()">退出登录</button>
        </div>
    </nav>

    <div class="container">
        <div class="header">
            <h1>系统运行状态 
                <span class="status-badge status-healthy">● 运行中</span>
            </h1>
            <p>监控时间: ${beijingTime.toISOString().replace('T', ' ').substring(0, 19)}</p>
            ${CONFIG.securePath ? `<p>安全路径: <code style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px;">${CONFIG.securePath}</code></p>` : ''}
        </div>

        <div class="grid">
            <div class="card">
                <h2>📊 请求统计</h2>
                <div class="metric">
                    <span class="metric-label">总请求数:</span>
                    <span class="metric-value">${stats.requests.total.toLocaleString()}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">错误总数:</span>
                    <span class="metric-value ${stats.errors.total > 0 ? 'error' : 'success'}">${stats.errors.total.toLocaleString()}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">错误率:</span>
                    <span class="metric-value ${parseFloat(stats.errors.rate) > 5 ? 'error' : parseFloat(stats.errors.rate) > 1 ? 'warning' : 'success'}">${stats.errors.rate}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">活跃连接:</span>
                    <span class="metric-value">${stats.connections.active}</span>
                </div>
            </div>

            <div class="card">
                <h2>⏱️ 延迟</h2>
                <div class="metric">
                    <span class="metric-label">P50:</span>
                    <span class="metric-value">${stats.latency.p50}ms</span>
                </div>
                <div class="metric">
                    <span class="metric-label">P95:</span>
                    <span class="metric-value">${stats.latency.p95}ms</span>
                </div>
                <div class="metric">
                    <span class="metric-label">P99:</span>
                    <span class="metric-value">${stats.latency.p99}ms</span>
                </div>
                <div class="progress-bar" style="margin-top: 10px;">
                    <div class="progress-fill" style="width: ${Math.min(100, (stats.latency.p95 / 1000) * 100)}%"></div>
                </div>
            </div>

            <div class="card">
                <h2>🚦 速率限制</h2>
                <div class="metric">
                    <span class="metric-label">状态:</span>
                    <span class="metric-value">
                        <span class="badge ${CONFIG.rateLimitEnabled ? 'badge-success' : 'badge-warning'}">
                            ${CONFIG.rateLimitEnabled ? '已启用' : '已禁用'}
                        </span>
                    </span>
                </div>
                <div class="metric">
                    <span class="metric-label">限制:</span>
                    <span class="metric-value">${stats.rateLimiter.maxRequests}/分钟</span>
                </div>
                <div class="metric">
                    <span class="metric-label">活跃客户端:</span>
                    <span class="metric-value">${stats.rateLimiter.totalEntries}</span>
                </div>
            </div>

            <div class="card">
                <h2>⚙️ 配置</h2>
                <div class="metric">
                    <span class="metric-label">重试机制:</span>
                    <span class="metric-value">
                        <span class="badge ${CONFIG.retryEnabled ? 'badge-success' : 'badge-warning'}">
                            ${CONFIG.retryEnabled ? `已启用 (${CONFIG.retryMaxAttempts}次)` : '已禁用'}
                        </span>
                    </span>
                </div>
                <div class="metric">
                    <span class="metric-label">日志:</span>
                    <span class="metric-value">
                        <span class="badge ${CONFIG.logEnabled ? 'badge-success' : 'badge-warning'}">
                            ${CONFIG.logEnabled ? CONFIG.logLevel : '已禁用'}
                        </span>
                    </span>
                </div>
                <div class="metric">
                    <span class="metric-label">超时时间:</span>
                    <span class="metric-value">${CONFIG.requestTimeout/1000}秒</span>
                </div>
            </div>
        </div>

        <div class="table-container">
            <h2>📈 按路径统计</h2>
            <table>
                <thead>
                    <tr>
                        <th>路径</th>
                        <th>请求数</th>
                        <th>占比</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(stats.requests.byPath)
                      .sort(([,a], [,b]) => (b as number) - (a as number))
                      .map(([path, count]) => `
                        <tr>
                            <td><code>${path}</code></td>
                            <td>${(count as number).toLocaleString()}</td>
                            <td>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <div class="progress-bar" style="width: 100px;">
                                        <div class="progress-fill" style="width: ${(count as number) / stats.requests.total * 100}%"></div>
                                    </div>
                                    ${((count as number) / stats.requests.total * 100).toFixed(1)}%
                                </div>
                            </td>
                        </tr>
                      `).join('')}
                </tbody>
            </table>
        </div>

        <div class="table-container">
            <h2>📊 状态码分布</h2>
            <table>
                <thead>
                    <tr>
                        <th>状态码</th>
                        <th>次数</th>
                        <th>占比</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(stats.requests.byStatus)
                      .sort(([,a], [,b]) => (b as number) - (a as number))
                      .map(([status, count]) => `
                        <tr>
                            <td>
                                <span class="badge ${parseInt(status) < 300 ? 'badge-success' : parseInt(status) < 400 ? 'badge-warning' : 'badge-error'}">
                                    ${status}
                                </span>
                            </td>
                            <td>${(count as number).toLocaleString()}</td>
                            <td>${((count as number) / stats.requests.total * 100).toFixed(1)}%</td>
                        </tr>
                      `).join('')}
                </tbody>
            </table>
        </div>

        <div class="footer">
            <p>系统监控面板 | 运行时间: ${Math.floor(stats.uptime / 1000 / 60)}分钟 | 
            <a href="#" onclick="location.reload()">刷新</a> | 
            <a href="${CONFIG.metricsPath}">JSON 指标</a></p>
        </div>
    </div>

    <script>
        async function handleLogout() {
            document.cookie = "${CONFIG.cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
            window.location.reload();
        }
        
        setTimeout(() => {
            location.reload();
        }, 60000);
    </script>
</body>
</html>
  `;
}

// ==================== 主请求处理 ====================
async function handleRequest(req: Request): Promise<Response> {
  const startTime = Date.now();
  metrics.incrementActive();
  
  const url = new URL(req.url);
  let response: Response | null = null;
  let error: Error | null = null;

  try {
    await logger.logRequest(req, startTime);

    // WebSocket 处理
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return await handleWebSocket(req);
    }

    // CORS 预检请求
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(),
      });
    }

    // 认证端点（不需要安全路径）
    if (url.pathname === "/auth" && req.method === "POST") {
      try {
        const body = await req.json();
        const { password } = body;
        
        if (validatePassword(password)) {
          const token = generateAuthCookie();
          
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": `${CONFIG.cookieName}=${token}; Max-Age=${CONFIG.cookieMaxAge}; Path=/; HttpOnly; SameSite=Lax`,
              ...getCorsHeaders(),
            },
          });
        } else {
          return new Response(JSON.stringify({ 
            success: false, 
            message: "密码错误" 
          }), {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              ...getCorsHeaders(),
            },
          });
        }
      } catch (e) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: "请求格式错误" 
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(),
          },
        });
      }
    }

    // 健康检查 API（不需要认证，不需要安全路径）
    if (url.pathname === CONFIG.healthCheckPath) {
      const stats = metrics.getStats();
      return new Response(JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        metrics: CONFIG.metricsEnabled ? {
          requests: stats.requests.total,
          errors: stats.errors.total,
          activeConnections: stats.connections.active,
          uptime: stats.uptime,
        } : undefined,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...getCorsHeaders(),
        },
      });
    }

    // 首页需要认证
    if (url.pathname === "/" || url.pathname === "") {
      const cookies = req.headers.get("cookie") || "";
      const authCookie = cookies.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith(`${CONFIG.cookieName}=`));
      
      const token = authCookie ? authCookie.split('=')[1] : null;
      
      if (!validateAuthCookie(token) && CONFIG.accessPassword) {
        const error = url.searchParams.get("error");
        return new Response(renderLoginPage(error ? "密码错误" : undefined), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            ...getCorsHeaders(),
          },
        });
      }
      
      return new Response(renderStatusPage(), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          ...getCorsHeaders(),
        },
      });
    }

    // 指标 API（需要认证）
    if (CONFIG.metricsEnabled && url.pathname === CONFIG.metricsPath) {
      const cookies = req.headers.get("cookie") || "";
      const authCookie = cookies.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith(`${CONFIG.cookieName}=`));
      
      const token = authCookie ? authCookie.split('=')[1] : null;
      
      if (!validateAuthCookie(token) && CONFIG.accessPassword) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(),
          },
        });
      }
      
      return new Response(JSON.stringify(metrics.getStats(), null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...getCorsHeaders(),
        },
      });
    }

    // ===== Telegram API 代理转发 =====
    // 检查路径是否需要转发到 Telegram
    let targetPath = url.pathname;
    
    // 如果设置了安全路径，检查请求路径是否以安全路径开头
    if (CONFIG.securePath) {
      if (targetPath.startsWith(CONFIG.securePath)) {
        // 移除安全路径前缀
        targetPath = targetPath.substring(CONFIG.securePath.length);
      } else {
        // 不是以安全路径开头，返回 404
        return new Response(JSON.stringify({
          ok: false,
          error_code: 404,
          description: "Not Found",
        }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...getCorsHeaders(),
          },
        });
      }
    }

    // 构建目标 URL
    const targetUrl = `${CONFIG.telegramApiBase}${targetPath}${url.search}`;
    
    logger.debug(`Proxying request`, {
      originalPath: url.pathname,
      targetPath: targetPath,
      targetUrl: targetUrl,
    });

    // 速率限制检查（对所有请求都进行限制）
    const clientId = await getClientId(req);
    const rateLimit = await rateLimiter.check(clientId);
    
    if (!rateLimit.allowed) {
      const waitTime = Math.ceil((rateLimit.resetTime - Date.now()) / 1000);
      return new Response(JSON.stringify({
        ok: false,
        error_code: 429,
        description: `Too Many Requests. Try again in ${waitTime} seconds`,
      }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": waitTime.toString(),
          "X-RateLimit-Limit": CONFIG.rateLimitRequests.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": Math.ceil(rateLimit.resetTime / 1000).toString(),
          ...getCorsHeaders(),
        },
      });
    }

    // 检查请求体大小
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > CONFIG.maxBodySize) {
      return new Response(JSON.stringify({
        ok: false,
        error_code: 413,
        description: "Request Entity Too Large",
      }), {
        status: 413,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(),
        },
      });
    }

    // 清理请求头
    const cleanedHeaders = cleanRequestHeaders(req.headers);

    // 准备请求选项
    const requestOptions: RequestInit = {
      method: req.method,
      headers: cleanedHeaders,
      redirect: "manual",
    };

    // 添加请求体
    if (req.method !== "GET" && req.method !== "HEAD") {
      requestOptions.body = req.body;
    }

    // 发送请求
    const proxyResponse = await fetchWithRetry(targetUrl, requestOptions);

    // 获取响应体大小
    let bytesTransferred = 0;
    if (proxyResponse.headers.has("content-length")) {
      bytesTransferred = parseInt(proxyResponse.headers.get("content-length")!);
    }

    // 清理响应头
    const cleanedResponseHeaders = cleanResponseHeaders(proxyResponse.headers);
    
    // 添加 CORS 和安全头
    Object.entries(getCorsHeaders()).forEach(([key, value]) => {
      cleanedResponseHeaders.set(key, value);
    });
    cleanedResponseHeaders.set("X-Content-Type-Options", "nosniff");
    cleanedResponseHeaders.set("X-Frame-Options", "DENY");
    cleanedResponseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");

    // 创建响应
    response = new Response(proxyResponse.body, {
      status: proxyResponse.status,
      statusText: proxyResponse.statusText,
      headers: cleanedResponseHeaders,
    });

    // 记录指标
    metrics.recordRequest(
      req.method,
      url.pathname,
      proxyResponse.status,
      Date.now() - startTime,
      bytesTransferred
    );

    return response;

  } catch (err) {
    error = err as Error;
    logger.error('Request handling failed', {
      error: error.message,
      stack: error.stack,
      path: url.pathname,
    });

    metrics.recordRequest(
      req.method,
      url.pathname,
      502,
      Date.now() - startTime
    );

    return new Response(JSON.stringify({
      ok: false,
      error_code: 502,
      description: "Bad Gateway",
      details: CONFIG.logLevel === 'debug' ? error.message : undefined,
    }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        ...getCorsHeaders(),
      },
    });

  } finally {
    metrics.decrementActive();
    if (response || error) {
      await logger.logRequest(req, startTime, response || undefined, error || undefined);
    }
  }
}

// ==================== 启动服务器 ====================
logger.info('Telegram API Proxy starting', {
  config: {
    telegramApiBase: CONFIG.telegramApiBase,
    port: CONFIG.proxyPort,
    securePath: CONFIG.securePath || "未设置（所有路径都转发）",
    authEnabled: !!CONFIG.accessPassword,
    rateLimitEnabled: CONFIG.rateLimitEnabled,
    retryEnabled: CONFIG.retryEnabled,
    logLevel: CONFIG.logLevel,
  },
});

Deno.serve({ port: CONFIG.proxyPort, hostname: CONFIG.proxyHost }, handleRequest);
