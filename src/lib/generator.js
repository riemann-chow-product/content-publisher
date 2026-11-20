/**
 * generator.js — Playwright 截图生成器
 *
 * 提供封面图、配图、代码块图片的生成能力。
 * 所有图片通过 HTML 模板渲染 + Playwright 截图实现。
 *
 * 导出:
 *   generateCover({ title, subtitle, style, width, height, out })
 *   generateIllustration({ description, style, width, height, out })
 *   generateCodeImage({ code, language, filename, out, width })
 *   generateArticleImages({ file, outDir, style })
 *   generateDiagram({ spec, out, style, width, height, scale })
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const Logger = require('./logger');
const { buildDiagramHTML, normalizeSpec } = require('./diagram');

const logger = new Logger();

// ─── 浏览器实例管理（惰性单例，自动关闭）─────────────────────
let _browser = null;
let _browserCloseTimer = null;
const BROWSER_IDLE_MS = 10_000;

function launchOptions() {
  const opts = { headless: true };
  // 优先复用系统 Chrome：CJK 字体稳定，且免去下载 Playwright 内核。
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  if (process.platform === 'darwin') {
    const found = candidates.find(p => fs.existsSync(p));
    if (found) opts.executablePath = found;
  }
  return opts;
}

async function getBrowser() {
  if (_browser) {
    clearTimeout(_browserCloseTimer);
  } else {
    try {
      _browser = await chromium.launch(launchOptions());
    } catch (e) {
      // 系统 Chrome 不可用（或版本不匹配）时回退到 Playwright 自带内核
      const fallback = launchOptions();
      delete fallback.executablePath;
      _browser = await chromium.launch(fallback);
    }
  }
  // 空闲 10s 后自动关闭，避免泄漏
  _browserCloseTimer = setTimeout(async () => {
    if (_browser) {
      await _browser.close().catch(() => {});
      _browser = null;
    }
  }, BROWSER_IDLE_MS);
  return _browser;
}

async function renderToFile(html, width, height, outPath, opts = {}) {
  const browser = await getBrowser();
  // Archify 风格图表默认 2x 输出：公众号 / CSDN 在手机端缩放后依然锐利。
  // 旧调用（封面、代码块图）保持 1x，避免破坏既有的微信封面尺寸规格。
  const scale = opts.scale || 1;
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  await page.setContent(html, { waitUntil: 'networkidle' });
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: outPath, type: 'png' });
  await page.close();
  return outPath;
}

// ─── 语法高亮（正则 Tokenizer）──────────────────────────────
const LANG_KEYWORDS = {
  bash: /\b(if|then|else|elif|fi|do|done|while|for|in|case|esac|function|select|export|local|return|break|continue|source)\b/g,
  javascript: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|throw|finally|typeof|instanceof|yield|of|in)\b/g,
  typescript: /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|throw|finally|typeof|instanceof|yield|of|in|interface|type|enum|implements|abstract|declare|namespace|readonly|as|is|keyof|infer)\b/g,
  python: /\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|raise|with|yield|lambda|pass|break|continue|and|or|not|is|in|True|False|None|async|await|global|nonlocal)\b/g,
  java: /\b(public|private|protected|static|final|abstract|class|interface|extends|implements|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|throw|throws|finally|import|package|void|int|long|double|float|boolean|char|String|this|super|null|true|false|instanceof|synchronized|volatile|transient|native|enum|var|record|sealed|permits)\b/g,
  go: /\b(func|package|import|var|const|type|struct|interface|map|chan|go|defer|return|if|else|for|range|switch|case|default|break|continue|select|fallthrough|nil|true|false|make|new|len|cap|append|delete|error|string|int|bool|byte|float64|int64)\b/g,
  rust: /\b(fn|let|mut|const|struct|enum|impl|trait|pub|use|mod|crate|self|super|if|else|for|while|loop|match|return|break|continue|async|await|move|ref|where|type|as|in|true|false|Some|None|Ok|Err|Vec|String|Box|Rc|Arc|Option|Result)\b/g,
};

const LANG_COMMANDS = {
  bash: /\b(claude|jq|osascript|sleep|echo|cd|ls|cat|grep|awk|sed|curl|wget|npm|npx|node|git|docker|kubectl|make|cargo|go|python|pip)\b/g,
};

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightCode(code, language) {
  let escaped = escapeHTML(code);
  const lang = (language || '').toLowerCase();
  const normLang = (lang === 'sh' || lang === 'shell') ? 'bash' : lang;

  // 占位符机制：已高亮的片段替换为 \x00idx\x00，避免后续正则破坏已有 span
  const slots = [];
  function hold(html) {
    const idx = slots.length;
    slots.push(html);
    return `\x00HL${idx}HL\x00`;
  }
  function restore(text) {
    return text.replace(/\x00HL(\d+)HL\x00/g, (_, i) => slots[i]);
  }

  // 1. 注释（最先提取，整行保护）
  if (normLang === 'bash' || normLang === 'python') {
    escaped = escaped.replace(/(#[^\n]*)/g, (m) => hold(`<span class="hl-comment">${m}</span>`));
  } else {
    escaped = escaped.replace(/(\/\/[^\n]*)/g, (m) => hold(`<span class="hl-comment">${m}</span>`));
    escaped = escaped.replace(/(\/\*[\s\S]*?\*\/)/g, (m) => hold(`<span class="hl-comment">${m}</span>`));
    escaped = escaped.replace(/(#[^\n]*)/g, (m) => hold(`<span class="hl-comment">${m}</span>`));
  }

  // 2. 字符串（提取保护）
  escaped = escaped.replace(/(&quot;[^&]*?&quot;)/g, (m) => hold(`<span class="hl-string">${m}</span>`));
  escaped = escaped.replace(/('[^']*?')/g, (m) => hold(`<span class="hl-string">${m}</span>`));
  escaped = escaped.replace(/(`[^`]*?`)/g, (m) => hold(`<span class="hl-string">${m}</span>`));

  // 3. 关键字（现在安全了，不会匹配到 span 属性）
  const kwPattern = LANG_KEYWORDS[normLang];
  if (kwPattern) {
    escaped = escaped.replace(new RegExp(kwPattern.source, kwPattern.flags), '<span class="hl-keyword">$1</span>');
  }

  // 4. 命令（bash 专用）
  const cmdPattern = LANG_COMMANDS[normLang];
  if (cmdPattern) {
    escaped = escaped.replace(new RegExp(cmdPattern.source, cmdPattern.flags), '<span class="hl-command">$1</span>');
  }

  // 5. /goal 命令高亮
  escaped = escaped.replace(/(\/goal)\b/g, '<span class="hl-command" style="font-weight:bold">$1</span>');

  // 6. 变量（bash）
  if (normLang === 'bash') {
    escaped = escaped.replace(/(\$\w+|\$\{[^}]+\})/g, '<span class="hl-variable">$1</span>');
    escaped = escaped.replace(/(\||&gt;|&lt;|&amp;&amp;)/g, '<span class="hl-keyword">$1</span>');
  }

  // 7. 数字
  escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>');

  // 8. 类型/注解（Java, Go, Rust, TS）
  if (['java', 'go', 'rust', 'typescript'].includes(normLang)) {
    escaped = escaped.replace(/\b([A-Z]\w+)\b/g, '<span class="hl-type">$1</span>');
  }

  // 还原占位符
  return restore(escaped);
}

// ─── HTML 模板 ──────────────────────────────────────────────

const THEME = {
  dark: {
    bg: '#0d1117', bgGrad: 'linear-gradient(135deg, #0d1117 0%, #161b22 40%, #1a1f2e 70%, #0d1117 100%)',
    titlebar: '#161b22', border: '#30363d', text: '#f0f6fc', sub: '#8b949e', muted: '#484f58',
    accent1: 'rgba(136,98,255,0.15)', accent2: 'rgba(56,189,248,0.12)',
    gridColor: 'rgba(88,166,255,0.05)',
  },
  light: {
    bg: '#ffffff', bgGrad: 'linear-gradient(135deg, #f6f8fa 0%, #ffffff 40%, #f0f3f6 70%, #f6f8fa 100%)',
    titlebar: '#f6f8fa', border: '#d0d7de', text: '#1f2328', sub: '#656d76', muted: '#8b949e',
    accent1: 'rgba(136,98,255,0.08)', accent2: 'rgba(56,189,248,0.06)',
    gridColor: 'rgba(0,0,0,0.03)',
  },
  gradient: {
    bg: '#0f0c29', bgGrad: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
    titlebar: '#1a1740', border: '#3d3770', text: '#e8e6f0', sub: '#a09cc0', muted: '#6b6590',
    accent1: 'rgba(160,120,255,0.2)', accent2: 'rgba(100,200,255,0.15)',
    gridColor: 'rgba(160,120,255,0.04)',
  },
};

function getTheme(style) {
  return THEME[style] || THEME.dark;
}

function buildCodeImageHTML(code, language, filename, width) {
  const highlighted = highlightCode(code, language);
  const lines = code.split('\n');
  const lineNumbers = lines.map((_, i) => i + 1).join('\n');
  const lineHeight = 24;

  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: transparent; }
  .hl-comment { color: #8b949e; font-style: italic; }
  .hl-string { color: #a5d6ff; }
  .hl-keyword { color: #ff7b72; }
  .hl-command { color: #d2a8ff; }
  .hl-variable { color: #79c0ff; }
  .hl-number { color: #79c0ff; }
  .hl-type { color: #ffa657; }
  .window {
    width: ${width}px;
    background: #0d1117;
    border-radius: 12px;
    border: 1px solid #30363d;
    overflow: hidden;
    font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, Monaco, 'Courier New', monospace;
  }
  .titlebar {
    height: 40px;
    background: #161b22;
    display: flex;
    align-items: center;
    padding: 0 16px;
    border-bottom: 1px solid #30363d;
  }
  .dots { display: flex; gap: 8px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot-red { background: #ff5f57; }
  .dot-yellow { background: #febc2e; }
  .dot-green { background: #28c840; }
  .filename {
    margin-left: 16px; color: #8b949e; font-size: 13px;
    background: #0d1117; padding: 4px 14px;
    border-radius: 6px 6px 0 0;
    border: 1px solid #30363d; border-bottom: 1px solid #0d1117;
    position: relative; top: 1px;
  }
  .code-area {
    display: flex; padding: 16px 0;
    font-size: 14px; line-height: ${lineHeight}px;
  }
  .line-numbers {
    color: #484f58; text-align: right;
    padding: 0 12px 0 16px; user-select: none;
    white-space: pre; border-right: 1px solid #21262d;
  }
  .code {
    color: #e6edf3; padding: 0 20px;
    white-space: pre; overflow-x: auto;
  }
</style></head>
<body>
<div class="window">
  <div class="titlebar">
    <div class="dots">
      <div class="dot dot-red"></div>
      <div class="dot dot-yellow"></div>
      <div class="dot dot-green"></div>
    </div>
    ${filename ? `<div class="filename">${escapeHTML(filename)}</div>` : ''}
  </div>
  <div class="code-area">
    <div class="line-numbers">${lineNumbers}</div>
    <div class="code">${highlighted}</div>
  </div>
</div>
</body></html>`;
}

function buildCoverHTML({ title, subtitle, style, width, height, footer = '' }) {
  const t = getTheme(style);
  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px; height: ${height}px;
    background: ${t.bgGrad};
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
    position: relative; overflow: hidden;
  }
  body::before {
    content: ''; position: absolute; inset: 0;
    background-image:
      linear-gradient(${t.gridColor} 1px, transparent 1px),
      linear-gradient(90deg, ${t.gridColor} 1px, transparent 1px);
    background-size: 40px 40px;
  }
  .glow-1 {
    position: absolute; width: 300px; height: 300px;
    background: radial-gradient(circle, ${t.accent1} 0%, transparent 70%);
    top: -80px; right: -50px; border-radius: 50%;
  }
  .glow-2 {
    position: absolute; width: 250px; height: 250px;
    background: radial-gradient(circle, ${t.accent2} 0%, transparent 70%);
    bottom: -60px; left: -30px; border-radius: 50%;
  }
  .content { position: relative; z-index: 1; text-align: center; padding: 0 60px; }
  .badge {
    display: inline-block;
    background: linear-gradient(135deg, #8862ff, #58a6ff);
    color: #fff; font-size: 14px; font-weight: 600;
    padding: 6px 20px; border-radius: 20px;
    margin-bottom: 24px; letter-spacing: 1px;
  }
  .title {
    color: ${t.text}; font-size: ${Math.max(24, Math.min(42, Math.floor(width / 22)))}px;
    font-weight: 700; line-height: 1.4; letter-spacing: 0.5px;
    text-shadow: 0 2px 20px rgba(0,0,0,0.3);
  }
  .title em {
    font-style: normal;
    background: linear-gradient(135deg, #58a6ff, #8862ff);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  .subtitle {
    color: ${t.sub}; font-size: 18px;
    margin-top: 20px; font-weight: 400;
  }
  .footer {
    position: absolute; bottom: 24px;
    left: 0; right: 0; text-align: center;
    color: ${t.muted}; font-size: 13px;
  }
</style></head>
<body>
  <div class="glow-1"></div>
  <div class="glow-2"></div>
  <div class="content">
    <div class="badge">深度解析</div>
    <div class="title">${title}</div>
    ${subtitle ? `<div class="subtitle">${escapeHTML(subtitle)}</div>` : ''}
  </div>
  <div class="footer">${escapeHTML(footer)}</div>
</body></html>`;
}

function buildIllustrationHTML({ description, style, width, height }) {
  const t = getTheme(style);
  // 如果描述包含分隔符，渲染为流程图
  const separators = ['->', '=>', '→', ',', '|'];
  const sep = separators.find(s => description.includes(s));

  if (sep) {
    const items = description.split(sep).map(s => s.trim()).filter(Boolean);
    const boxesHTML = items.map((item, i) => {
      const isLast = i === items.length - 1;
      return `<div class="flow-item">
        <div class="flow-box">${escapeHTML(item)}</div>
        ${!isLast ? '<div class="flow-arrow">→</div>' : ''}
      </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px; height: ${height}px;
    background: ${t.bgGrad};
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif;
  }
  .flow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; padding: 20px; }
  .flow-item { display: flex; align-items: center; gap: 8px; }
  .flow-box {
    background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.3);
    color: ${t.text}; padding: 14px 24px; border-radius: 10px;
    font-size: 15px; font-weight: 500;
  }
  .flow-arrow { color: #58a6ff; font-size: 24px; }
</style></head>
<body><div class="flow">${boxesHTML}</div></body></html>`;
  }

  // 否则渲染为概念卡片
  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px; height: ${height}px;
    background: ${t.bgGrad};
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif;
    position: relative; overflow: hidden;
  }
  body::before {
    content: ''; position: absolute; inset: 0;
    background-image:
      linear-gradient(${t.gridColor} 1px, transparent 1px),
      linear-gradient(90deg, ${t.gridColor} 1px, transparent 1px);
    background-size: 40px 40px;
  }
  .card {
    position: relative; z-index: 1;
    background: rgba(22,27,34,0.8); border: 1px solid ${t.border};
    border-radius: 16px; padding: 40px 50px; text-align: center;
    max-width: ${Math.floor(width * 0.8)}px;
  }
  .card-title {
    color: ${t.text}; font-size: 24px; font-weight: 700;
    line-height: 1.5;
  }
</style></head>
<body>
<div class="card">
  <div class="card-title">${escapeHTML(description)}</div>
</div>
</body></html>`;
}

// ─── 公开 API ───────────────────────────────────────────────

const { aspectFor, resolveSize } = require('./size');

async function generateCover({ title, subtitle = '', style = 'dark', width, height, aspect, out = 'cover.png' }) {
  logger.spin('生成封面图...');
  const size = resolveSize({ aspect, width, height, kind: 'cover' });
  const html = buildCoverHTML({ title, subtitle, style, width: size.width, height: size.height });
  await renderToFile(html, size.width, size.height, out);
  logger.spinSucceed(`封面图已生成: ${out} (${size.aspect} · ${size.width}×${size.height})`);
  return { out, ...size };
}

async function generateIllustration({ description, style = 'dark', width, height, aspect, out = 'illustration.png' }) {
  logger.spin('生成配图...');
  // 旧实现把 alt 文本原样写进一张居中卡片 —— 文章里那不是"图"。
  // 现在至少产出一张有节点、有连线、有图例的概念图。
  const parts = String(description)
    .split(/\s*(?:->|=>|→|,|，|\||、)\s*/)
    .map(x => x.trim()).filter(Boolean);
  const theme = style === 'light' ? 'light' : 'dark';
  const spec = parts.length >= 2 ? {
    title: '', subtitle: '', badge: 'FLOW', layout: 'row', theme,
    nodes: parts.map((p, i) => ({
      id: 'n' + i, label: p,
      kind: i === 0 ? 'client' : (i === parts.length - 1 ? 'db' : 'service'),
    })),
    edges: parts.slice(1).map((_, i) => ({ from: 'n' + i, to: 'n' + (i + 1), primary: i === 0 })),
  } : {
    title: String(description), subtitle: '', badge: 'CONCEPT', layout: 'row', theme,
    nodes: [
      { id: 'b', label: '输入 / 触发', sub: 'Input', kind: 'client' },
      { id: 'a', label: String(description), kind: 'service' },
      { id: 'c', label: '输出 / 结果', sub: 'Output', kind: 'db' },
    ],
    edges: [
      { from: 'b', to: 'a', label: '处理' },
      { from: 'a', to: 'c', label: '产出', primary: true },
    ],
  };
  // 配图高度按节点数量估算：少节点用扁画幅，多节点再变高，不再一律 4:3。
  const nodeCount = Math.max(3, parts.length || 3);
  const estimatedW = Math.min(1440, nodeCount * 218 + 40);
  const estimatedH = nodeCount > 5 ? 320 : 240;
  const size = resolveSize({
    aspect, width, height, kind: 'illustration',
    contentWidth: estimatedW, contentHeight: estimatedH,
  });
  await generateDiagram({ spec, out, style, width: size.width, height: size.height, scale: 2, autoFit: true });
  logger.spinSucceed(`配图已生成: ${out} (${size.aspect} · ${size.width}×${size.height})`);
}

/**
 * 生成 Archify 风格静态图（分层泳道 / 类型化节点 / 标准箭头 / 主路径高亮 / 图例）。
 * spec 可以是 JSON 对象、JSON 字符串，或 .json 文件路径。
 *
 * 渲染器会在浏览器内跑完整校验（布局、文字、箭头距离、画布比例）并自动修复；
 * 这里强制读取 window.__DIAGRAM_AUDIT__，任何一条规则不通过就抛错，不产出坏图。
 */
async function generateDiagram({ spec, out = 'diagram.png', style, width = 1200, height = 675, scale = 2, autoFit = true }) {
  logger.spin('生成图表...');
  let raw = spec;
  if (typeof spec === 'string' && !spec.trim().startsWith('{')) {
    raw = fs.readFileSync(spec, 'utf-8');
  }
  const normalized = normalizeSpec(raw);
  if (style) normalized.theme = style === 'light' ? 'light' : 'dark';

  let page = null;
  const renderAt = async (h) => {
    const browser = await getBrowser();
    if (page) await page.close().catch(() => {});
    page = await browser.newPage({ viewport: { width, height: h }, deviceScaleFactor: scale });
    await page.setContent(buildDiagramHTML(normalized, { width, height: h }), { waitUntil: 'networkidle' });
    return page.evaluate(() => window.__DIAGRAM_AUDIT__ || null);
  };

  let finalHeight = height;
  let audit = await renderAt(finalHeight);

  // 画布高度自适应：横向内容太矮时收紧画布，避免上下大片留白。
  // 收紧后必须重新校验；若反而校验不过，退回原尺寸。
  if (autoFit && audit && audit.contentBox && audit.stageBox) {
    const fixed = height - audit.stageBox.h;
    const fitted = Math.max(360, Math.min(height, Math.round((fixed + audit.contentBox.height / 0.42) / 10) * 10));
    if (fitted < height - 12) {
      const retry = await renderAt(fitted);
      if (retry && retry.passed) {
        finalHeight = fitted;
        audit = retry;
      } else {
        audit = await renderAt(height);
      }
    }
  }

  if (audit && !audit.passed) {
    await page.close().catch(() => {});
    const failed = Object.entries(audit.checks || {})
      .filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.detail}`);
    throw new Error(`图表校验未通过（不产出坏图）:\n  ${failed.join('\n  ')}\n修复记录: ${(audit.repairs || []).join(' | ')}`);
  }

  const dir = path.dirname(out);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: out, type: 'png' });
  await page.close();
  logger.spinSucceed(`图表已生成: ${out}`);
  return { out, height: finalHeight, audit };
}

/**
 * renderV2 — 矢量优先的编辑级图表（新增，保留旧 generateDiagram 不动）。
 * spec 可传对象 / JSON 字符串 / .json 路径；同时输出 PNG + SVG 源文件。
 */
async function renderV2({ spec, out = 'diagram.png', theme = 'light', aspect, scale = 2, svgOnly = false }) {
  const { buildSVG } = require('./diagram-v2');
  let raw = spec;
  if (typeof spec === 'string') {
    raw = spec.trim().startsWith('{') ? JSON.parse(spec) : JSON.parse(fs.readFileSync(spec, 'utf-8'));
  }
  if (theme) raw.theme = theme === 'dark' ? 'dark' : 'light';
  const { svg, width, height, audit, aspect: usedAspect, ratio } = buildSVG(raw, aspect ? { aspect } : {});

  const dir = path.dirname(out);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const svgPath = out.replace(/\.png$/i, '.svg');
  fs.writeFileSync(svgPath, svg, 'utf-8');

  if (!svgOnly) {
    const browser = await getBrowser();
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: scale,
    });
    await page.setContent(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${width}px;height:${height}px;overflow:hidden}</style></head><body>${svg}</body></html>`,
      { waitUntil: 'networkidle' }
    );
    await page.screenshot({ path: out, type: 'png' });
    await page.close();
  }
  logger.spinSucceed(`图表已生成: ${svgOnly ? svgPath : out} (${usedAspect}${ratio ? ` ≈${Number(ratio).toFixed(2)}:1` : ''} · ${width}×${height}${svgOnly ? '' : ` @${scale}x`}, 校验${audit.passed && audit.arrowDirection.ok ? '通过' : '未通过'})`);
  return { out: svgOnly ? svgPath : out, svgPath, width, height, aspect: usedAspect, ratio, audit };
}

async function generateCodeImage({ code, language = 'bash', filename = '', out = 'code.png', width = 780 }) {
  const html = buildCodeImageHTML(code, language, filename, width);
  const lines = code.split('\n').length;
  const height = lines * 24 + 80;
  await renderToFile(html, width, height, out);
  return out;
}

async function generateArticleImages({ file, outDir = '.', style = 'dark', keepBlock = false }) {
  const md = fs.readFileSync(file, 'utf-8');
  const baseDir = outDir || path.dirname(file);
  const theme = style === 'light' ? 'light' : 'dark';

  // 0) 结构化图代码块：```diagram <file.png>\n{...spec...}\n```
  //    生成 Archify 风格 PNG，并默认把代码块替换成图片引用，文章里只留图片。
  const diagramPattern = /```diagram\s+([^\s`]+\.png)\s*\n([\s\S]*?)```/g;
  const diagrams = [];
  let dm;
  while ((dm = diagramPattern.exec(md)) !== null) {
    diagrams.push({ block: dm[0], imgFile: dm[1], specText: dm[2] });
  }
  let outMd = md;
  if (diagrams.length) logger.info(`发现 ${diagrams.length} 个 diagram 图表块，开始生成...`);
  for (const d of diagrams) {
    const imgPath = path.resolve(baseDir, d.imgFile);
    try {
      const spec = normalizeSpec(d.specText);
      spec.theme = theme;
      await generateDiagram({ spec, out: imgPath, width: 1200, height: 675, scale: 2 });
      if (!keepBlock) {
        const alt = spec.title || d.imgFile.replace(/\.png$/, '').replace(/[-_]/g, ' ');
        outMd = outMd.replace(d.block, `![${alt}](${d.imgFile})`);
      }
      logger.info(`  ✅ ${d.imgFile} (Archify 风格图表, 2x)`);
    } catch (err) {
      logger.warn(`  ⚠️ ${d.imgFile} 图表生成失败: ${err.message}`);
    }
  }
  if (!keepBlock && outMd !== md) {
    fs.writeFileSync(file, outMd, 'utf-8');
    logger.info(`已把 diagram 代码块替换为图片引用: ${file}`);
  }

  // 1) 扫描 ![alt](file.png) 引用，找出不存在的图片
  const imgPattern = /!\[([^\]]*)\]\(([^)]+\.png)\)/g;
  const missing = [];
  let match;
  while ((match = imgPattern.exec(outMd)) !== null) {
    const [, alt, imgFile] = match;
    const imgPath = path.resolve(baseDir, imgFile);
    if (!fs.existsSync(imgPath)) {
      missing.push({ alt, file: imgFile, path: imgPath });
    }
  }

  if (missing.length === 0) {
    logger.info('所有图片已存在，无需生成');
    return;
  }

  logger.info(`发现 ${missing.length} 张缺失图片，开始生成...`);

  // 2) 扫描 markdown 代码块，为代码块图片生成内容
  const codeBlockPattern = /```(\w*)\n([\s\S]*?)```/g;
  const codeBlocks = [];
  while ((match = codeBlockPattern.exec(outMd)) !== null) {
    codeBlocks.push({ language: match[1] || 'text', code: match[2].trimEnd() });
  }

  let codeIdx = 0;
  for (const img of missing) {
    const alt = img.alt.toLowerCase();

    if (alt.includes('code') || alt.includes('代码') || alt.includes('命令') || alt.includes('脚本') || alt.includes('示例')) {
      if (codeIdx < codeBlocks.length) {
        const block = codeBlocks[codeIdx++];
        await generateCodeImage({
          code: block.code,
          language: block.language,
          filename: path.basename(img.file, '.png'),
          out: img.path,
          width: 780,
        });
        logger.info(`  ✅ ${img.file} (代码块)`);
      }
    } else if (alt.includes('cover') || alt.includes('封面')) {
      await generateCover({ title: img.alt, style, out: img.path });
    } else {
      await generateIllustration({
        description: img.alt,
        style,
        out: img.path,
      });
      logger.info(`  ✅ ${img.file} (Archify 风格概念图, 2x)`);
    }
  }

  logger.info(`\n🎉 ${missing.length} 张图片生成完毕`);
}

module.exports = {
  generateCover,
  generateIllustration,
  generateCodeImage,
  generateArticleImages,
  generateDiagram,
  renderV2,
  buildDiagramHTML,
};
