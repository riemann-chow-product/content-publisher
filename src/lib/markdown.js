/**
 * Markdown 解析器
 * 提取 Front-matter 元数据和正文内容
 */
'use strict';

const fs = require('fs');

/**
 * 解析 Markdown 文件
 */
function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parse(raw);
}

/**
 * 解析 Markdown 字符串
 */
function parse(content) {
  const lines = content.split(/\r?\n/);
  const meta = {};
  let bodyStart = 0;

  // 检测 Front-matter (--- 包裹)
  if (lines[0] === '---') {
    const endIdx = lines.findIndex((line, i) => i > 0 && line === '---');
    if (endIdx !== -1) {
      const yamlContent = lines.slice(1, endIdx).join('\n');
      try {
        const yaml = require('js-yaml');
        Object.assign(meta, yaml.load(yamlContent));
      } catch (e) {
        // YAML 解析失败，忽略
      }
      bodyStart = endIdx + 1;
    }
  }

  const bodyLines = lines.slice(bodyStart);
  const text = bodyLines.join('\n');

  return {
    meta,
    text,
    html: markdownToHtml(text),
    raw: content,
    wordCount: text.replace(/[#*`_\[\]]/g, '').length,
  };
}

/**
 * 核心：Markdown → HTML 转换
 * 采用逐行分块策略，避免嵌套歧义
 * 注意：不在此处添加样式，由 renderForWechat 统一处理
 */
function markdownToHtml(md) {
  if (!md) return '';

  // 第一步：提取代码块，用占位符替换（防止全局转义破坏代码内容）
  const codeBlocks = [];
  let html = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(renderCodeBlock(lang, code.trim()));
    return `\n__CODE_BLOCK_${index}__\n`;
  });

  // 第二步：转义 HTML（保留 Markdown 语法），此时代码块已被占位符保护
  html = html
    .replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 第三步：还原代码块
  codeBlocks.forEach((block, i) => {
    html = html.replace(`__CODE_BLOCK_${i}__`, block);
  });

  // 第二步：处理标题
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 第三步：处理行内代码
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.06);color:#d14;padding:2px 6px;border-radius:4px;font-size:90%;font-family:Consolas,Monaco,\'Courier New\',monospace;">$1</code>');

  // 第四步：处理链接和图片
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 第五步：处理分割线
  html = html.replace(/^---+$/gm, '<hr />');
  html = html.replace(/^\*\*\*+$/gm, '<hr />');

  // 第六步：处理删除线
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 第七步：逐行分块处理（表格、列表、引用、段落）
  const blockHtml = processBlocks(html);

  return blockHtml;
}

/**
 * 逐行分块处理
 */
function processBlocks(html) {
  const lines = html.split('\n');
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 跳过空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 代码块行（<section 是 renderCodeBlock 输出的外层容器）
    if (line.startsWith('<pre') || line.startsWith('<code') || line.startsWith('</pre>') || line.startsWith('</section>') || line.startsWith('<section style="margin:20px')) {
      output.push(line);
      i++;
      continue;
    }

    // 标题行
    if (line.startsWith('<h')) {
      output.push(applyInlineStyles(line));
      i++;
      continue;
    }

    // 分割线
    if (line.startsWith('<hr')) {
      output.push(line);
      i++;
      continue;
    }

    // 图片行
    if (line.startsWith('<img')) {
      output.push(line);
      i++;
      continue;
    }

    // 表格行（整块处理）
    if (line.includes('|')) {
      const tableBlock = parseTableBlock(lines, i);
      output.push(tableBlock.html);
      i = tableBlock.nextIndex;
      continue;
    }

    // 引用块行
    if (line.startsWith('<blockquote>') || line.startsWith('&gt;')) {
      const quoteBlock = parseQuoteBlock(lines, i);
      output.push(quoteBlock.html);
      i = quoteBlock.nextIndex;
      continue;
    }

    // 列表项
    if (/^(\s*)[-*+] /.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const listBlock = parseListBlock(lines, i);
      output.push(listBlock.html);
      i = listBlock.nextIndex;
      continue;
    }

    // 段落：收集连续非块级行
    const paraLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') break;
      if (l.startsWith('<h') || l.startsWith('<pre') || l.startsWith('<hr') ||
          l.startsWith('<blockquote') || l.startsWith('<table') || l.startsWith('<ul') ||
          l.startsWith('<ol') || l.startsWith('<img') || l.startsWith('</') ||
          l.startsWith('<section style="position:relative') ||
          l.includes('|') || /^(\s*)[-*+] /.test(l) || /^\s*\d+\.\s+/.test(l)) {
        break;
      }
      paraLines.push(l);
      i++;
    }

    if (paraLines.length > 0) {
      const paraText = paraLines.join('<br />');
      output.push(`<p>${applyInlineStyles(paraText)}</p>`);
    }
  }

  return output.join('\n');
}

/**
 * 解析连续表格行
 */
function parseTableBlock(lines, start) {
  const tableLines = [];
  let i = start;

  while (i < lines.length && lines[i].includes('|')) {
    tableLines.push(lines[i]);
    i++;
  }

  const dataRows = tableLines.filter(l => !/^\|[\s\-:\|]+\|$/.test(l.trim()));
  if (dataRows.length === 0) {
    return { html: tableLines.join(''), nextIndex: i };
  }

  const headers = dataRows[0].split('|').map(c => c.trim()).filter(Boolean);
  let html = `<table><thead><tr>`;
  for (const h of headers) {
    html += `<th>${applyInlineStyles(h)}</th>`;
  }
  html += `</tr></thead><tbody>`;
  for (let r = 1; r < dataRows.length; r++) {
    const cells = dataRows[r].split('|').map(c => c.trim()).filter(Boolean);
    html += `<tr>`;
    for (const cell of cells) {
      html += `<td>${applyInlineStyles(cell)}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;

  return { html, nextIndex: i };
}

/**
 * 解析连续引用块（不添加样式）
 */
function parseQuoteBlock(lines, start) {
  const quoteLines = [];
  let i = start;

  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === '' || (!l.startsWith('<blockquote') && !l.startsWith('&gt;') && !l.startsWith('<p>—'))) {
      if (l.includes('|') || l.startsWith('<h') || l.startsWith('<pre') ||
          l.startsWith('```') || /^(\s*)[-*+] /.test(l) || /^\s*\d+\./.test(l)) {
        break;
      }
    }
    if (!l.startsWith('<blockquote')) {
      const content = l.replace(/^&gt;\s*/, '').trim();
      if (content) {
        quoteLines.push(applyInlineStyles(content));
      }
    } else {
      quoteLines.push(l);
    }
    i++;
    if (i < lines.length && lines[i].trim() === '' && quoteLines.length > 0) {
      break;
    }
  }

  const html = `<blockquote>${quoteLines.map(l => `<p>${l}</p>`).join('')}</blockquote>`;
  return { html, nextIndex: i };
}

/**
 * 解析连续列表块（不添加样式）
 */
function parseListBlock(lines, start) {
  const listItems = [];
  let i = start;
  let isOrdered = false;

  while (i < lines.length) {
    const l = lines[i].trim();

    const ulMatch = l.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      listItems.push(`<li>${applyInlineStyles(ulMatch[1])}</li>`);
      i++;
      continue;
    }

    const olMatch = l.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      isOrdered = true;
      listItems.push(`<li>${applyInlineStyles(olMatch[1])}</li>`);
      i++;
      continue;
    }

    if (l.startsWith('|') || l.startsWith('&gt;') || l.startsWith('<') || l === '') {
      break;
    }

    const indentMatch = l.match(/^\s{2,}(.+)$/);
    if (indentMatch && listItems.length > 0) {
      const lastIdx = listItems.length - 1;
      listItems[lastIdx] = listItems[lastIdx].replace(/<\/li>$/, `<br />${applyInlineStyles(indentMatch[1])}</li>`);
      i++;
      continue;
    }

    break;
  }

  if (listItems.length === 0) {
    return { html: '', nextIndex: i };
  }

  const tag = isOrdered ? 'ol' : 'ul';
  const html = `<${tag}>${listItems.join('')}</${tag}>`;
  return { html, nextIndex: i };
}

/**
 * 应用行内样式（加粗、斜体）
 */
function applyInlineStyles(text) {
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  return text;
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 提取文章中所有图片 URL
 */
function extractImages(content) {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    images.push({ alt: match[1], src: match[2] });
  }
  return images;
}

/**
 * 渲染为平台适配的格式
 */
function renderForPlatform(md, platform) {
  const parsed = parse(md);

  switch (platform) {
    case 'wechat':
      return renderForWechat(parsed);
    case 'zhihu':
      return parsed.text;
    case 'weibo':
      return parsed.text.replace(/[#*`_\[\]]/g, '').slice(0, 2000);
    default:
      return parsed.html;
  }
}

/**
 * 微信公众号精品样式渲染
 * 样式：标题左侧色块 + 交错表格 + 醒目引用 + 深色代码
 */
function renderForWechat(parsed) {
  let html = parsed.html;

  // ---- 1. 标题样式 ----
  html = html.replace(/<h1>(.+?)<\/h1>/g,
    (_, t) => `<h1 style="font-weight:bold;margin:32px 0 20px;font-size:24px;text-align:center;padding:18px 24px;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#fff;border-radius:10px;line-height:1.6;letter-spacing:0.5px;">${t}</h1>`);
  html = html.replace(/<h2>(.+?)<\/h2>/g,
    (_, t) => `<h2 style="font-weight:bold;margin:32px 0 14px;font-size:18px;padding:10px 0 10px 18px;border-left:5px solid #00b4d8;background:linear-gradient(to right,rgba(0,180,216,0.09),transparent);line-height:1.6;color:#1a1a2e;">${t}</h2>`);
  html = html.replace(/<h3>(.+?)<\/h3>/g,
    (_, t) => `<h3 style="font-weight:bold;margin:24px 0 10px;font-size:16px;padding:7px 0 7px 16px;border-left:4px solid #0077b6;background:linear-gradient(to right,rgba(0,119,182,0.07),transparent);line-height:1.6;color:#2d3436;">${t}</h3>`);
  html = html.replace(/<h4>(.+?)<\/h4>/g,
    (_, t) => `<h4 style="font-weight:bold;margin:18px 0 8px;font-size:15px;color:#333;padding-left:14px;border-left:3px solid #48b6d1;line-height:1.5;">${t}</h4>`);

  // ---- 2. 引用块 ----
  html = html.replace(/<blockquote>/g,
    `<blockquote style="border-left:4px solid #00b4d8;margin:18px 0;padding:14px 20px;background:linear-gradient(135deg,rgba(0,180,216,0.07),rgba(0,119,182,0.03));border-radius:0 10px 10px 0;color:#444;line-height:2;font-size:15px;">`);

  // ---- 3. 代码块 ----
  // 已在第一步直接渲染（renderCodeBlock），此处无需再处理

  // ---- 4. 表格（自适应宽度，无横向滚动） ----
  html = html.replace(/(<table[\s\S]*?<\/table>)/g,
    '<section style="width:100%;max-width:100%;margin:18px 0;background:#fafbfc;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">$1</section>');
  html = html.replace(/<table>/g,
    `<table style="border-collapse:collapse;width:100%;table-layout:auto;">`);
  html = html.replace(/<th>/g,
    `<th style="background:linear-gradient(135deg,#0077b6,#00b4d8);color:#fff;font-weight:bold;padding:10px 12px;border:1px solid rgba(255,255,255,0.15);text-align:left;font-size:13px;word-break:break-word;">`);
  html = html.replace(/<td>/g,
    `<td style="padding:9px 12px;border:1px solid #e8eef5;font-size:13px;line-height:1.8;color:#333;word-break:break-word;">`);

  // ---- 5. 链接 ----
  html = html.replace(/<a href=/g,
    `<a style="color:#00b4d8;text-decoration:none;border-bottom:1px solid rgba(0,180,216,0.4);" href=`);

  // ---- 6. 段落 ----
  html = html.replace(/<p>/g,
    `<p style="margin:12px 0;line-height:2.1;font-size:15px;color:#333;">`);

  // ---- 7. 列表 ----
  html = html.replace(/<ul>/g,
    `<ul style="margin:12px 0;padding-left:22px;">`);
  html = html.replace(/<ol>/g,
    `<ol style="margin:12px 0;padding-left:22px;">`);
  html = html.replace(/<li>/g,
    `<li style="margin:5px 0;line-height:2;font-size:15px;color:#444;">`);

  // ---- 8. 分割线 ----
  html = html.replace(/<hr \/>/g,
    `<hr style="border:none;border-top:1px solid #e0e8f0;margin:28px 0;" />`);

  // ---- 9. 图片（普通图片） ----
  html = html.replace(/<img /g,
    `<img style="max-width:100%;border-radius:10px;margin:14px 0;display:block;box-shadow:0 4px 16px rgba(0,0,0,0.08);" `);

  // ---- 9b. 公式图片（LaTeX 渲染的 PNG）居中 + 深色背景适配 ----
  html = html.replace(
    /<img ([^>]*?)alt="formula"([^>]*)\/?>/g,
    '<div style="text-align:center;margin:20px 0;"><img $1$2 style="max-width:90%;display:inline-block;border-radius:8px;box-shadow:none;background:#0f1423;padding:12px 24px;" /></div>'
  );

  // ---- 10. 表格偶数行背景 ----
  html = html.replace(/(<tr>)(<td style="padding:10px 14px;border:1px solid #e8eef5;font-size:14px;line-height:1.7;color:#333;">)/g,
    '$1<td style="background:#f8fbff;padding:10px 14px;border:1px solid #e8eef5;font-size:14px;line-height:1.7;color:#333;">');

  // ---- 11. 居中标签 ----
  // <!-- center -->...<!-- /center --> 被转义后变成 &lt;!-- center --&gt;...&lt;!-- /center --&gt;
  html = html.replace(/&lt;!--\s*center\s*--&gt;([\s\S]*?)&lt;!--\s*\/center\s*--&gt;/g,
    (_, content) => `<section style="text-align:center;">${content.trim()}</section>`);

  return html;
}

/**
 * 仿主流代码排版风格（GitHub/掘金风格）
 * - 顶部标题栏（深色条 + 三小圆点 + 语言标签）
 * - 左侧行号（灰色，可切换）
 * - 语法高亮（VS Code Dark+ 配色）
 * - 圆角阴影卡片
 */
function renderCodeBlock(lang, code) {
  // 语言显示名映射
  const langNames = {
    python: 'Python', java: 'Java', javascript: 'JavaScript', js: 'JS',
    typescript: 'TypeScript', ts: 'TS', go: 'Go', rust: 'Rust',
    cpp: 'C++', c: 'C', sql: 'SQL', bash: 'Bash', shell: 'Shell',
    yaml: 'YAML', json: 'JSON', xml: 'XML', html: 'HTML', css: 'CSS',
  };
  const langLabel = langNames[lang] || (lang ? lang.toUpperCase() : '');

  // 先 HTML 转义（高亮函数会再注入 <span> 标签）
  const escapedCode = escapeHtml(code);

  // 按行处理，语法高亮
  const lines = escapedCode.split('\n');
  const totalLines = lines.length;
  const highlightedLines = lines.map(line => highlightLine(line, lang));

  // 将标签外的空格替换为 &nbsp; 防止微信吞掉 span 间的空格
  // 思路：先把 HTML 标签保护起来，替换文本中的空格，再还原标签
  const safeLines = highlightedLines.map(hl => {
    const tags = [];
    const placeholder = hl.replace(/<[^>]+>/g, m => {
      tags.push(m);
      return `\x00${tags.length - 1}\x00`;
    });
    const spaced = placeholder.replace(/ /g, '&nbsp;');
    return spaced.replace(/\x00(\d+)\x00/g, (_, i) => tags[i]);
  });

  // 换行策略：在 <pre> 内使用 <br/> 标签分隔每行代码
  const codeContent = safeLines.join('<br/>');
  // 外层容器：控制宽度和横向滚动
  return `<section style="margin:20px 0;border-radius:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;background:#1e1e1e;"><pre style="color:#d4d4d4;padding:16px 20px;font-size:14px;line-height:1.9;font-family:Menlo,Consolas,Monaco,'Courier New',monospace;white-space:nowrap;word-break:keep-all;overflow-wrap:normal;tab-size:4;">${codeContent}</pre></section>`;
}

/**
 * 仿 VS Code Dark+ 单行语法高亮
 * 颜色对照：
 *   关键词 #569cd6 (蓝)  字符串 #ce9178 (橙)  注释 #6a9955 (绿)
 *   数字   #b5cea8 (浅绿)  函数调用 #dcdcaa (黄)  装饰器 #dcdcaa (黄)
 *   类型   #4ec9b0 (青)  操作符 #d4d4d4 (白)  self/this #569cd6 (蓝)
 */
function highlightLine(line, lang) {
  let result = line;

  if (line.trim() === '') return ' ';  // 空行返回空格，保留行号对齐

  // ---- Python 高亮 ----
  if (lang === 'python') {
    // 1. 先保护字符串（单引号/双引号/三引号）
    const strings = [];
    result = result.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|f?"[^"\n]*"|f?'[^'\n]*')/g, m => {
      strings.push(m);
      return `__STR${strings.length - 1}__`;
    });

    // 2. 保护注释
    const comments = [];
    result = result.replace(/(#.*)$/gm, m => {
      comments.push(m);
      return `__CMT${comments.length - 1}__`;
    });

    // 3. 装饰器 @xxx.yyy 或 @xxx
    result = result.replace(/(@[\w.]+)/g, '<span style="color:#dcdcaa;">$1</span>');

    // 4. 函数调用 xxx( — VS Code Dark+ 黄色
    result = result.replace(/\b(\w+)(\()/g, '<span style="color:#dcdcaa;">$1</span>$2');

    // 5. 关键词
    const pyKeywords = ['import','from','as','def','class','return','if','elif','else','for','while','try','except','finally','with','async','await','yield','lambda','pass','break','continue','raise','and','or','not','in','is','None','True','False','global','nonlocal','assert','del'];
    const kwRe = new RegExp(`\\b(${pyKeywords.join('|')})\\b`, 'g');
    result = result.replace(kwRe, '<span style="color:#569cd6;">$1</span>');

    // 6. self
    result = result.replace(/\bself\b/g, '<span style="color:#569cd6;">self</span>');

    // 7. 内置函数/类型
    const pyBuiltins = ['print','len','range','type','int','str','float','list','dict','set','tuple','bool','super','isinstance','getattr','setattr','hasattr','enumerate','zip','map','filter','sorted','reversed','any','all','min','max','sum','abs','open','format','input','next','iter','property','staticmethod','classmethod'];
    const biRe = new RegExp(`\\b(${pyBuiltins.join('|')})\\b`, 'g');
    result = result.replace(biRe, '<span style="color:#4ec9b0;">$1</span>');

    // 8. 数字
    result = result.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#b5cea8;">$1</span>');

    // 8. 恢复字符串
    strings.forEach((s, i) => {
      result = result.replace(`__STR${i}__`, `<span style="color:#ce9178;">${s}</span>`);
    });

    // 9. 恢复注释
    comments.forEach((c, i) => {
      result = result.replace(`__CMT${i}__`, `<span style="color:#6a9955;">${c}</span>`);
    });

    return result;
  }

  // ---- Java 高亮 ----
  if (lang === 'java') {
    const strings = [];
    result = result.replace(/("[^"\n]*")/g, m => {
      strings.push(m);
      return `__STR${strings.length - 1}__`;
    });

    const comments = [];
    result = result.replace(/(\/\/.*)$/gm, m => {
      comments.push(m);
      return `__CMT${comments.length - 1}__`;
    });

    // 注解 @xxx.yyy 或 @xxx
    result = result.replace(/(@[\w.]+)/g, '<span style="color:#dcdcaa;">$1</span>');

    // 函数调用 xxx(
    result = result.replace(/\b(\w+)(\()/g, '<span style="color:#dcdcaa;">$1</span>$2');

    const javaKeywords = ['public','private','protected','static','final','abstract','class','interface','extends','implements','new','return','if','else','for','while','do','switch','case','break','continue','default','try','catch','finally','throw','throws','void','boolean','int','long','double','float','char','byte','short','String','import','package','this','super','null','true','false','instanceof','synchronized','volatile','transient','native','enum','assert'];
    const kwRe = new RegExp(`\\b(${javaKeywords.join('|')})\\b`, 'g');
    result = result.replace(kwRe, '<span style="color:#569cd6;">$1</span>');

    // 数字
    result = result.replace(/\b(\d+\.?\d*[LfDd]?)\b/g, '<span style="color:#b5cea8;">$1</span>');

    strings.forEach((s, i) => {
      result = result.replace(`__STR${i}__`, `<span style="color:#ce9178;">${s}</span>`);
    });

    comments.forEach((c, i) => {
      result = result.replace(`__CMT${i}__`, `<span style="color:#6a9955;">${c}</span>`);
    });

    return result;
  }

  // ---- 通用高亮（Bash/Go/其他） ----
  // 字符串
  const strings = [];
  result = result.replace(/("[^"\n]*"|'[^'\n]*')/g, m => {
    strings.push(m);
    return `__STR${strings.length - 1}__`;
  });

  // 注释
  const comments = [];
  result = result.replace(/(#.*|\/\/.*)$/gm, m => {
    comments.push(m);
    return `__CMT${comments.length - 1}__`;
  });

  // 函数调用 xxx(
  result = result.replace(/\b(\w+)(\()/g, '<span style="color:#dcdcaa;">$1</span>$2');

  // 通用关键词
  const genKeywords = ['function','return','if','else','for','while','do','switch','case','break','continue','default','try','catch','finally','throw','new','class','extends','implements','import','package','export','from','const','let','var','type','struct','interface','func','go','defer','chan','select','range','map','nil','true','false','null','undefined','async','await','yield','fn','pub','mod','use','mut','impl','trait','where','self','Self'];
  const kwRe = new RegExp(`\\b(${genKeywords.join('|')})\\b`, 'g');
  result = result.replace(kwRe, '<span style="color:#569cd6;">$1</span>');

  // 数字
  result = result.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#b5cea8;">$1</span>');

  strings.forEach((s, i) => {
    result = result.replace(`__STR${i}__`, `<span style="color:#ce9178;">${s}</span>`);
  });

  comments.forEach((c, i) => {
    result = result.replace(`__CMT${i}__`, `<span style="color:#6a9955;">${c}</span>`);
  });

  return result;
}

module.exports = {
  parse,
  parseFile,
  markdownToHtml,
  extractImages,
  renderForPlatform,
};
