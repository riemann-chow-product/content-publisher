/**
 * LaTeX 预处理器 v3
 * 将 Markdown 中的 $$...$$ 块公式和 $...$ 行内公式，
 * 通过 CodeCogs API 渲染为高质量本地 PNG 图片（带缓存）。
 *
 * API: https://latex.codecogs.com/png.latex?\Huge\;{formula}
 *   - \Huge  = 块级公式大字号
 *   - \large = 行内公式中等字号
 *   - 不支持 \color / \bgcolor，用 CSS 样式控制
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

/**
 * 构建 CodeCogs 渲染 URL
 *
 * 正确的 CodeCogs png.latex 接口：
 *   https://latex.codecogs.com/png.latex?\Huge\;{latex}
 *
 * 支持的 LaTeX 大小命令：
 *   \tiny \scriptsize \footnotesize \small \normalsize
 *   \large \Large \LARGE \huge \Huge
 */
function buildCodecogsUrl(latex, opts = {}) {
  const isBlock = !!opts.block;
  // 块级用 \Huge，行内用 \large
  const sizeCmd = isBlock ? '\\Huge' : '\\large';
  // URL 编码整个 LaTeX 表达式
  const encodedLatex = encodeURIComponent(`${sizeCmd}\\;${latex}`);
  return `https://latex.codecogs.com/png.latex?${encodedLatex}`;
}

/** 获取公式缓存路径 */
function getCachePath(articleDir, latex) {
  const hash = crypto.createHash('md5').update(latex).digest('hex').slice(0, 12);
  return path.join(articleDir, 'formulas', `eq_${hash}.png`);
}

/** 确保目录存在 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * 下载单张公式图片
 */
function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    // 缓存命中
    if (fs.existsSync(destPath)) {
      try {
        const sz = fs.statSync(destPath).size;
        if (sz > 500) {
          console.log(`  [latex] ✓ cache: ${path.basename(destPath)} (${(sz/1024).toFixed(1)}KB)`);
          return resolve(destPath);
        }
      } catch (_) {}
    }

    const req = https.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 300) {
          return reject(new Error(`Response too small (${buf.length}B)`));
        }
        ensureDir(path.dirname(destPath));
        fs.writeFileSync(destPath, buf);
        console.log(`  [latex] ✓ rendered: ${path.basename(destPath)} (${(buf.length/1024).toFixed(1)}KB)`);
        resolve(destPath);
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * 批量处理公式（串行 + 间隔防限流）
 */
async function processFormulas(formulaList) {
  const results = [];
  for (const f of formulaList) {
    try {
      const dest = await downloadImage(f.url, f.dest);
      results.push({ ...f, dest, ok: true });
    } catch (err) {
      console.warn(`  [latex] ✗ "${f.latex}": ${err.message}`);
      results.push({ ...f, ok: false });
    }
    if (results.length < formulaList.length) {
      await new Promise(r => setTimeout(r, 350));
    }
  }
  return results;
}

/**
 * 预处理 Markdown 内容中的 LaTeX 公式
 *
 * @param {string} content - Markdown 原文
 * @param {string} articleDir - 文章所在目录
 * @returns {{ content: string, failed: Array }}
 */
async function preprocessLatex(content, articleDir) {
  // ── 收集公式 ──

  const blocks = [];
  const inlines = [];
  let m;

  // 块级：$$...$$ （跨行）
  const blockRegex = /\$\$([\s\S]+?)\$\$/g;
  while ((m = blockRegex.exec(content)) !== null) {
    const latex = m[1].trim();
    blocks.push({
      latex,
      type: 'block',
      url: buildCodecogsUrl(latex, { block: true }),
      dest: getCachePath(articleDir, `block:${latex}`),
    });
  }

  // 行内：$...$ （不跨行）
  const inlineRegex = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g;
  while ((m = inlineRegex.exec(content)) !== null) {
    const latex = m[1].trim();
    if (latex.includes('formulas/') || latex.startsWith('![')) continue;
    inlines.push({
      latex,
      type: 'inline',
      url: buildCodecogsUrl(latex, { block: false }),
      dest: getCachePath(articleDir, `inline:${latex}`),
    });
  }

  const total = blocks.length + inlines.length;
  if (total === 0) return { content, failed: [] };

  console.log(`[latex] ${blocks.length} block + ${inlines.length} inline formulas → rendering...`);

  // ── 批量渲染 ──
  const results = await processFormulas([...blocks, ...inlines]);

  // ── 替换回 content ──
  let out = content;
  const failed = [];

  for (const f of results) {
    const relPath = path.relative(articleDir, f.dest).replace(/\\/g, '/');

    if (f.ok) {
      const imgMd = f.type === 'block'
        ? `\n\n![formula](${relPath})\n\n`
        : `![formula](${relPath})`;

      if (f.type === 'block') {
        out = out.replace(`$$${f.latex}$$`, imgMd);
      } else {
        const escaped = f.latex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(`$${f.latex}$`, imgMd);
      }
    } else {
      const fallback = `<code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;">$${f.latex}$</code>`;
      if (f.type === 'block') {
        out = out.replace(`$$${f.latex}$$`, fallback);
      } else {
        out = out.replace(`$${f.latex}$`, fallback);
      }
      failed.push(f);
    }
  }

  if (failed.length > 0) {
    console.warn(`[latex] ⚠ ${failed.length}/${total} failed`);
  }

  return { content: out, failed };
}

module.exports = { preprocessLatex };
