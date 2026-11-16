/**
 * 日志输出工具
 */
'use strict';

// chalk v5+ 是 ESM，同步降级方案：如果 chalk ESM 不可用就用纯文本
let chalk = null;
try {
  // 尝试 require chalk v4（CJS）
  chalk = require('chalk');
  // 确认它是真正的 chalk 对象（v4），不是 ESM wrapper
  if (typeof chalk.red !== 'function') {
    chalk = null;
  }
} catch (_e) {
  chalk = null;
}

// 纯文本 fallback（无颜色，但保证同步）
const plain = {
  red: s => s, green: s => s, blue: s => s, yellow: s => s, gray: s => s,
  bold: s => s, dim: s => s, cyan: s => s, magenta: s => s,
};
const c = chalk || plain;

// ora v8+ 也是 ESM-only，降级使用 v6
let ora = null;
try {
  ora = require('ora');
  if (typeof ora !== 'function') ora = null;
} catch (_e) {
  ora = null;
}

const DEBUG = process.env.DEBUG === '1';
const QUIET = process.env.QUIET === '1';

class Logger {
  constructor() {
    this.spinner = null;
  }

  debug(...args) {
    if (DEBUG) console.log(c.gray('[DEBUG]'), ...args);
  }

  info(...args) {
    if (!QUIET) console.log(c.blue('ℹ'), ...args);
  }

  success(...args) {
    if (!QUIET) console.log(c.green('✓'), ...args);
  }

  warn(...args) {
    if (!QUIET) console.log(c.yellow('⚠'), ...args);
  }

  error(...args) {
    console.error(c.red('✗'), ...args);
  }

  spin(text) {
    if (QUIET || !ora || !process.stdout.isTTY) return;
    try {
      this.spinner = ora({ text, color: 'cyan' }).start();
    } catch (_e) {
      // spinner 不可用时降级为静默
    }
  }

  spinSucceed(text) {
    if (this.spinner) {
      try { this.spinner.succeed(text); } catch (_e) { console.log(c.green('✓'), text); }
      this.spinner = null;
    } else if (!QUIET) {
      console.log(c.green('✓'), text);
    }
  }

  spinFail(text) {
    if (this.spinner) {
      try { this.spinner.fail(text); } catch (_e) { console.error(c.red('✗'), text); }
      this.spinner = null;
    } else {
      console.error(c.red('✗'), text);
    }
  }

  spinWarn(text) {
    if (this.spinner) {
      try { this.spinner.warn(text); } catch (_e) { console.log(c.yellow('⚠'), text); }
      this.spinner = null;
    } else if (!QUIET) {
      console.log(c.yellow('⚠'), text);
    }
  }

  /**
   * 输出表格
   * @param {string[]} headers
   * @param {string[][]} rows
   */
  table(headers, rows) {
    if (QUIET) return;
    const widths = headers.map((h, i) => {
      const max = Math.max(h.length, ...rows.map(r => (r[i] || '').length));
      return max + 2;
    });

    // 表头
    const headerLine = headers.map((h, i) => c.bold(h.padEnd(widths[i]))).join('');
    console.log(headerLine);
    console.log(widths.map(w => '─'.repeat(w)).join(''));

    // 行
    for (const row of rows) {
      console.log(row.map((cell, i) => (cell || '').padEnd(widths[i])).join(''));
    }
  }

  /**
   * 输出 JSON（调试用）
   */
  json(data) {
    if (DEBUG || !QUIET) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

module.exports = Logger;
