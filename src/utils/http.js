/**
 * HTTP 请求工具封装
 * 统一处理错误、超时、重试
 */
'use strict';

const DEBUG = process.env.DEBUG === '1';

class HttpClient {
  constructor({ timeout = 30000, retries = 2 } = {}) {
    this.timeout = timeout;
    this.retries = retries;
  }

  async get(url, options = {}) {
    return this.request(url, { ...options, method: 'GET' });
  }

  async post(url, body, options = {}) {
    return this.request(url, { ...options, method: 'POST', body });
  }

  async request(url, { method = 'GET', body, headers = {}, retries } = {}) {
    const maxRetries = retries ?? this.retries;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        let data;
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        if (DEBUG) {
          console.log(`[HTTP] ${method} ${url} → ${response.status}`);
        }

        return { status: response.status, headers: response.headers, data };
      } catch (err) {
        lastError = err;
        if (err.name === 'AbortError') {
          lastError = new Error(`请求超时: ${url}`);
        }
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 1000));
        }
      }
    }

    throw lastError;
  }
}

module.exports = HttpClient;
