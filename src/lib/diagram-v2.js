/**
 * diagram-v2.js — 矢量优先的「编辑级」技术图表渲染器
 *
 * 设计目标：一次成图，不再需要 image2 二次润色。
 *   - 纯 SVG 输出：任意倍率缩放都锐利，不依赖浏览器 CSS 测量后再缩字
 *   - 四种图表语汇：architecture / flow / sequence / deployment
 *   - 编辑级排版：清晰的层级、克制的配色、8px 栅格、充足留白
 *   - 内容自适应画布：高度由内容决定，不再把图挤进固定 1200x675 后缩小
 *
 * 输入 spec（兼容旧 spec 的核心字段，并新增 type）：
 * {
 *   "type": "architecture | flow | sequence | deployment",
 *   "title": "...", "subtitle": "...", "badge": "...", "footnote": "...",
 *   "theme": "light | dark",
 *   "groups":  [{ id, label, tone }],                      // architecture / deployment 的泳道/区域
 *   "nodes":   [{ id, label, sub, kind, group, shape, zone }],
 *   "edges":   [{ from, to, label, primary, dashed }],
 *   "participants": [{ id, label, sub }],                  // sequence
 *   "messages": [{ from, to, label, type, activate }],     // sequence
 *   "legend": true
 * }
 *
 * 纯函数，零运行时依赖：spec -> { svg, width, height, audit }。
 */
'use strict';

const { aspectFor, normalizeAspect, fitCanvas } = require('./size');

// ─── 设计令牌 ─────────────────────────────────────────────────
const THEMES = {
  light: {
    bg: '#FBFCFE', grid: 'rgba(16,24,40,0.035)',
    ink: '#101828', sub: '#475467', muted: '#98A2B3',
    card: '#FFFFFF', border: '#E4E7EC', borderStrong: '#D0D5DD',
    lane: 'rgba(255,255,255,0.66)', laneBorder: '#D0D5DD',
    line: '#98A2B3', lineStrong: '#475467',
    labelBg: '#FFFFFF', labelInk: '#344054',
    divider: '#EAECF0', shadow: 'rgba(16,24,40,0.08)',
    numberBg: '#F2F4F7',
  },
  dark: {
    bg: '#0B0F17', grid: 'rgba(255,255,255,0.045)',
    ink: '#F2F4F7', sub: '#A6B0BE', muted: '#6B7686',
    card: '#151B26', border: '#2A3441', borderStrong: '#3A4656',
    lane: 'rgba(255,255,255,0.025)', laneBorder: '#334052',
    line: '#7C8899', lineStrong: '#C2CCD8',
    labelBg: '#151B26', labelInk: '#D6DEE8',
    divider: '#232C39', shadow: 'rgba(0,0,0,0.45)',
    numberBg: '#1D2634',
  },
};

const KIND = {
  client:   { color: '#1570EF', soft: '#EFF4FF', glyph: 'user' },
  network:  { color: '#0E9384', soft: '#E7F8F5', glyph: 'net' },
  service:  { color: '#6938EF', soft: '#F1ECFF', glyph: 'cube' },
  db:       { color: '#079455', soft: '#E7F7EF', glyph: 'db' },
  cache:    { color: '#DC6803', soft: '#FFF4E6', glyph: 'bolt' },
  queue:    { color: '#DD2590', soft: '#FDECF6', glyph: 'queue' },
  external: { color: '#667085', soft: '#F2F4F7', glyph: 'cloud' },
  default:  { color: '#2970FF', soft: '#EAF1FF', glyph: 'cube' },
};
const TONE = {
  blue: '#1570EF', cyan: '#0E9384', violet: '#6938EF',
  green: '#079455', amber: '#DC6803', pink: '#DD2590', gray: '#667085',
};
const KINDS_ORDER = ['client', 'network', 'service', 'db', 'cache', 'queue', 'external'];

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 估算文本宽度（CJK≈1em，ASCII 按字形宽度），用于自适应节点尺寸。 */
function textW(s, fs) {
  let w = 0;
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c >= 0x2E80) w += fs * 1.0;
    else if (/[MW@#%]/.test(ch)) w += fs * 0.92;
    else if (/[iljt.,:;'!|` ]/.test(ch)) w += fs * 0.30;
    else if (/[A-Z0-9]/.test(ch)) w += fs * 0.64;
    else w += fs * 0.54;
  }
  return w;
}

/** 按最大宽度折行（优先在标点/空格处断，其次按字符断）。 */
function wrapText(s, fs, maxW) {
  const str = String(s == null ? '' : s);
  if (textW(str, fs) <= maxW) return [str];
  const lines = [];
  let cur = '';
  for (const ch of str) {
    const next = cur + ch;
    if (cur && textW(next, fs) > maxW) { lines.push(cur); cur = ch; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function kindOf(n) { return KIND[n.kind] ? n.kind : 'default'; }

// ─── 节点尺寸 ─────────────────────────────────────────────────
const LABEL_FS = 17, SUB_FS = 12.5;

function sizeNode(n) {
  const label = n.label || n.id;
  const subLines = n.sub ? wrapText(n.sub, SUB_FS, 236) : [];
  let w = Math.max(150, textW(label, LABEL_FS) + 58);
  for (const ln of subLines) w = Math.max(w, textW(ln, SUB_FS) + 58);
  w = Math.min(w, 300);
  const h = 20 + 24 + (subLines.length ? subLines.length * 17 + 6 : 0) + 12;
  return { w, h, subLines };
}

// ─── 图标（纯 SVG） ───────────────────────────────────────────
function iconSVG(kind, cx, cy, color) {
  const k = KIND[kind] || KIND.default;
  const p = {
    user: '<circle cx="0" cy="-3.4" r="2.6"/><path d="M-5 5.4c0-2.7 2.2-4.4 5-4.4s5 1.7 5 4.4"/>',
    net: '<circle cx="0" cy="0" r="5.2"/><path d="M-5.2 0h10.4M0-5.2c2.1 2 2.1 8.4 0 10.4M0-5.2c-2.1 2-2.1 8.4 0 10.4"/>',
    cube: '<path d="M0-5.6 5.2-2.8v5.6L0 5.6 -5.2 2.8v-5.6z"/><path d="M-5.2-2.8 0 0l5.2-2.8M0 0v5.6"/>',
    db: '<ellipse cx="0" cy="-3.6" rx="4.8" ry="1.9"/><path d="M-4.8-3.6v7.2c0 1.1 2.2 1.9 4.8 1.9s4.8-.8 4.8-1.9v-7.2"/><path d="M-4.8 0c0 1.1 2.2 1.9 4.8 1.9S4.8 1.1 4.8 0"/>',
    bolt: '<path d="M1.4-5.6-3.4.6h3.2l-1 5 4.8-6.2H.4z"/>',
    queue: '<path d="M-4.8-3.4h9.6M-4.8 0h9.6M-4.8 3.4h9.6"/><circle cx="-3.2" cy="-3.4" r="1"/><circle cx="-3.2" cy="0" r="1"/><circle cx="-3.2" cy="3.4" r="1"/>',
    cloud: '<path d="M-3.6 4.4h6.2a2.8 2.8 0 0 0 .3-5.6 4.4 4.4 0 0 0-8.4-.4 3 3 0 0 0 1.9 6z"/>',
  }[k.glyph] || '<circle r="2.4"/>';
  return `<g transform="translate(${cx},${cy})" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p}</g>`;
}

// ─── 校验 ─────────────────────────────────────────────────────
function auditLayout(nodes, edges, W, H) {
  const overlap = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ow > 1 && oh > 1) overlap.push(`${a.id}/${b.id}`);
    }
  }
  const outside = nodes.filter(n => n.x < 0 || n.y < 0 || n.x + n.w > W || n.y + n.h > H).map(n => n.id);
  return {
    passed: overlap.length === 0 && outside.length === 0,
    nodeOverlap: overlap, canvasOverflow: outside,
    arrowRendered: edges.length, nodeCount: nodes.length,
  };
}

// ─── 布局：分层（architecture / deployment / flow） ────────────
function layerNodes(spec) {
  const nodes = spec.nodes.map(n => ({ ...n, ...sizeNode(n) }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = (spec.edges || []).filter(e => byId.has(e.from) && byId.has(e.to));

  // 决定列（layer）：group 优先；否则按最长路径分层
  const order = spec.groups ? spec.groups.map(g => g.id) : [];
  if (spec.groups) {
    nodes.forEach(n => { if (n.group && order.includes(n.group)) n._col = order.indexOf(n.group); else n._col = 0; });
  } else {
    const indeg = new Map(nodes.map(n => [n.id, 0]));
    edges.forEach(e => indeg.set(e.to, (indeg.get(e.to) || 0) + 1));
    const layer = new Map(nodes.map(n => [n.id, 0]));
    const queue = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
    const seen = new Set(queue);
    while (queue.length) {
      const id = queue.shift();
      for (const e of edges.filter(e => e.from === id)) {
        layer.set(e.to, Math.max(layer.get(e.to), layer.get(id) + 1));
        if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
      }
    }
    nodes.forEach(n => n._col = layer.get(n.id));
  }
  return { nodes, byId, edges };
}

function layoutTiers(spec, cfg) {
  const { nodes, byId, edges } = layerNodes(spec);
  const cols = {};
  nodes.forEach(n => { (cols[n._col] = cols[n._col] || []).push(n); });
  const colKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);
  let gapX = cfg.gapX || 86, gapY = cfg.gapY || 26;

  const colW = {}, colH = {};
  colKeys.forEach(k => {
    colW[k] = Math.max(...cols[k].map(n => n.w));
    colH[k] = cols[k].reduce((s, n) => s + n.h, 0) + gapY * (cols[k].length - 1);
  });

  let x = cfg.pad;
  const colX = {};
  colKeys.forEach(k => { colX[k] = x; x += colW[k] + gapX; });
  const contentW = x - gapX + cfg.pad;
  let W = Math.max(cfg.minW || 1080, Math.ceil(contentW));
  const maxH = Math.max(...colKeys.map(k => colH[k]));
  const bodyTop = cfg.bodyTop;
  let H = bodyTop + maxH + cfg.footH;

  // 目标画幅：把额外空间摊进列间距 / 节点纵向间距，而不是留大片空白。
  // 只增大间距，绝不缩小节点或文字。
  if (cfg.targetW && cfg.targetH && colKeys.length) {
    const naturalBodyH = maxH;
    const wantBodyH = Math.max(naturalBodyH, cfg.targetH - bodyTop - cfg.footH);
    const extraH = wantBodyH - naturalBodyH;
    if (extraH > 0 && colKeys.length > 1) {
      const wantW = Math.max(W, cfg.targetW);
      gapX += Math.max(0, (wantW - W) / (colKeys.length - 1));
      W = wantW;
      colKeys.forEach(k => {
        const cnt = cols[k].length;
        if (cnt > 1) colH[k] += extraH; // 该列的节点纵向铺开
      });
    }
    x = cfg.pad;
    colKeys.forEach(k => { colX[k] = x; x += colW[k] + gapX; });
    W = Math.max(W, Math.ceil(x - gapX + cfg.pad));
    H = bodyTop + Math.max(...colKeys.map(k => colH[k])) + cfg.footH;
    colKeys.forEach(k => {
      const cnt = cols[k].length;
      const localGapY = cnt > 1 ? gapY + extraH / (cnt - 1) : gapY;
      const stackH = cols[k].reduce((s, n) => s + n.h, 0) + localGapY * (cnt - 1);
      const startY = bodyTop + (Math.max(...colKeys.map(key => colH[key])) - stackH) / 2;
      let y = startY;
      cols[k].forEach(n => {
        n.x = Math.round(colX[k] + (colW[k] - n.w) / 2);
        n.y = Math.round(y);
        y += n.h + localGapY;
      });
    });
  } else {
    colKeys.forEach(k => {
      const startY = bodyTop + (maxH - colH[k]) / 2;
      let y = startY;
      cols[k].forEach(n => {
        n.x = Math.round(colX[k] + (colW[k] - n.w) / 2);
        n.y = Math.round(y);
        y += n.h + gapY;
      });
    });
  }
  return { nodes, byId, edges, cols, colKeys, colX, colW, W, H, bodyTop };
}

// ─── 布局：时序图 ─────────────────────────────────────────────
function layoutSequence(spec, cfg) {
  const parts = (spec.participants || spec.nodes || []).map(p => ({ ...p }));
  const msgs = (spec.messages || spec.edges || []).map((m, i) => ({ ...m, _i: i }));
  const n = parts.length;
  const partW = 168, minGap = 56;
  const contentW = n * partW + (n - 1) * minGap;
  let W = Math.ceil(Math.max(cfg.minW || 1080, contentW + cfg.pad * 2));
  const startX = (W - contentW) / 2;
  const yTop = cfg.bodyTop;
  const partH = 58;
  parts.forEach((p, i) => {
    p.x = Math.round(startX + i * (partW + minGap));
    p.y = yTop; p.w = partW; p.h = partH;
    p.cx = p.x + partW / 2;
  });
  let rowH = 66;
  let msgTop = yTop + partH + 46;
  let lifeBottom = msgTop + msgs.length * rowH + 34;
  let H = lifeBottom + cfg.footH - 20;

  // 目标画幅：把剩余空间摊到消息行距与参与者列距，避免大片空白
  if (cfg.targetW && cfg.targetH) {
    W = Math.max(W, cfg.targetW);
    const extraGap = n > 1 ? (W - cfg.pad * 2 - contentW) / (n - 1) : 0;
    parts.forEach((p, i) => {
      p.x = Math.round((W - (contentW + extraGap * (n - 1))) / 2 + i * (partW + minGap + extraGap));
      p.cx = p.x + partW / 2;
    });
    const wantH = Math.max(H, cfg.targetH);
    const extra = wantH - H;
    if (msgs.length > 1) rowH += extra / msgs.length;
    msgTop = yTop + partH + 46;
    lifeBottom = msgTop + msgs.length * rowH + 34;
    msgs.forEach((m, i) => { m.y = msgTop + i * rowH + rowH / 2; });
    H = lifeBottom + cfg.footH - 20;
  } else {
    msgs.forEach((m, i) => { m.y = msgTop + i * rowH + rowH / 2; });
  }
  return { parts, msgs, W, H, yTop, partH, lifeBottom, msgTop, rowH };
}

// ─── SVG 片段 ─────────────────────────────────────────────────
function defsSVG(W, H, t) {
  return `<defs>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="${t.grid}" stroke-width="1"/>
    </pattern>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="${t.shadow}" flood-opacity="0.9"/>
    </filter>
    <linearGradient id="primary" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0">
      <stop offset="0%" stop-color="#1570EF"/><stop offset="100%" stop-color="#6938EF"/>
    </linearGradient>
    <filter id="glow" x="-2000" y="-2000" width="6000" height="6000">
      <feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <marker id="arrow" viewBox="0 0 12 10" refX="10.5" refY="5" markerWidth="11" markerHeight="9"
      markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 12 5 0 10 3 5z" fill="${t.lineStrong}"/></marker>
    <marker id="arrow-p" viewBox="0 0 12 10" refX="10.5" refY="5" markerWidth="11" markerHeight="9"
      markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 12 5 0 10 3 5z" fill="#6938EF"/></marker>
    <marker id="arrow-open" viewBox="0 0 12 10" refX="10.5" refY="5" markerWidth="11" markerHeight="9"
      markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1 11 5 1 9" fill="none" stroke="${t.lineStrong}" stroke-width="1.8"/></marker>
  </defs>`;
}

function headerSVG(spec, W, t) {
  const kicker = spec.badge || ({
    architecture: 'SYSTEM ARCHITECTURE', flow: 'PROCESS FLOW',
    sequence: 'SEQUENCE DIAGRAM', deployment: 'NETWORK DEPLOYMENT',
  }[spec.type] || 'DIAGRAM');
  return `<g>
    <rect x="0" y="26" width="${Math.min(260, 22 + textW(kicker, 11) + 22)}" height="26" rx="13" fill="${t.numberBg}" stroke="${t.border}"/>
    <text x="37" y="43" font-size="11" font-weight="700" letter-spacing="2.2" fill="${t.sub}">${esc(kicker)}</text>
    ${spec.title ? `<text x="0" y="92" font-size="30" font-weight="700" letter-spacing="0.3" fill="${t.ink}">${esc(spec.title)}</text>` : ''}
    ${spec.subtitle ? `<text x="0" y="120" font-size="15" font-weight="400" fill="${t.sub}">${esc(spec.subtitle)}</text>` : ''}
    <line x1="0" y1="${spec.subtitle ? 142 : 112}" x2="${W}" y2="${spec.subtitle ? 142 : 112}" stroke="${t.divider}" stroke-width="1"/>
  </g>`;
}

function footerSVG(spec, W, H, t, usedKinds) {
  const items = usedKinds.filter(k => KIND[k]).map(k =>
    `<g transform="translate(0,0)"><rect x="0" y="-9" width="9" height="9" rx="2.5" fill="${KIND[k].color}"/>` +
    `<text x="16" y="0" font-size="11.5" fill="${t.sub}">${esc(KIND[k].label || kindLabel(k))}</text></g>`);
  let lx = 0;
  const legend = items.map(g => {
    const out = g.replace('translate(0,0)', `translate(${lx},0)`);
    lx += 118;
    return out;
  }).join('');
  return `<g transform="translate(0,${H - 22})">
    ${spec.legend !== false && legend ? legend : ''}
    ${spec.footnote ? `<text x="${W}" y="0" font-size="11" fill="${t.muted}" text-anchor="end">${esc(spec.footnote)}</text>` : ''}
  </g>`;
}
function kindLabel(k) {
  return ({ client: '客户端', network: '网络 / 负载', service: '服务 / 计算', db: '存储 / 数据库',
    cache: '缓存 / 中间件', queue: '消息 / 队列', external: '第三方 / 边界', default: '组件' })[k] || k;
}

function nodeSVG(n, t, shape) {
  const kind = kindOf(n), meta = KIND[kind];
  const soft = t.bg === '#FBFCFE' ? meta.soft : hexA(meta.color, 0.14);
  const cx = n.x, cy = n.y, w = n.w, h = n.h;
  const label = n.label || n.id;
  const subLines = n.subLines || (n.sub ? wrapText(n.sub, SUB_FS, 236) : []);
  const iconX = cx + 20, iconY = cy + h / 2;
  const textX = cx + 44;
  let outline;

  if (shape === 'terminal') {
    outline = `<rect x="${cx}" y="${cy}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.card}" stroke="${borderOf(meta.color, t)}" stroke-width="1.5" filter="url(#shadow)"/>`;
  } else if (shape === 'decision') {
    const mx = cx + w / 2, my = cy + h / 2;
    outline = `<path d="M${mx} ${cy} L${cx + w} ${my} L${mx} ${cy + h} L${cx} ${my} Z" fill="${t.card}" stroke="${borderOf(meta.color, t)}" stroke-width="1.5" filter="url(#shadow)"/>`;
    return `<g>${outline}${iconSVG(kind, mx, my - 9, meta.color)}
      <text x="${mx}" y="${my + 16}" font-size="15" font-weight="600" fill="${t.ink}" text-anchor="middle">${esc(label)}</text></g>`;
  } else if (shape === 'data') {
    const ry = 7;
    outline = `<path d="M${cx + ry} ${cy} H${cx + w - ry} A${ry} ${ry} 0 0 1 ${cx + w} ${cy + ry} V${cy + h - ry} A${ry} ${ry} 0 0 1 ${cx + w - ry} ${cy + h} H${cx + ry} A${ry} ${ry} 0 0 1 ${cx} ${cy + h - ry} V${cy + ry} A${ry} ${ry} 0 0 1 ${cx + ry} ${cy} Z" fill="${t.card}" stroke="${borderOf(meta.color, t)}" stroke-width="1.5" filter="url(#shadow)"/>`;
  } else {
    outline = `<rect x="${cx}" y="${cy}" width="${w}" height="${h}" rx="12" fill="${t.card}" stroke="${borderOf(meta.color, t)}" stroke-width="1.5" filter="url(#shadow)"/>`;
  }

  const labelY = cy + 27;
  const subs = subLines.map((ln, i) =>
    `<text x="${textX}" y="${labelY + 20 + i * 17}" font-size="${SUB_FS}" fill="${t.sub}">${esc(ln)}</text>`).join('');
  return `<g>
    ${outline}
    <rect x="${cx}" y="${cy + 12}" width="3.5" height="${h - 24}" rx="1.75" fill="${meta.color}"/>
    <rect x="${iconX - 13}" y="${iconY - 13}" width="26" height="26" rx="8" fill="${soft}"/>
    ${iconSVG(kind, iconX, iconY, meta.color)}
    <text x="${textX}" y="${labelY}" font-size="${LABEL_FS}" font-weight="600" fill="${t.ink}">${esc(label)}</text>
    ${subs}
  </g>`;
}
function borderOf(color, t) { return t.bg === '#FBFCFE' ? hexA(color, 0.42) : hexA(color, 0.55); }
function hexA(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function anchors(a, b) {
  const acx = a.x + a.w / 2, bcx = b.x + b.w / 2;
  if (bcx > a.x + a.w + 12) return { x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2, dir: 'h' };
  if (bcx < a.x - 12) return { x1: a.x, y1: a.y + a.h / 2, x2: b.x + b.w, y2: b.y + b.h / 2, dir: 'hl' };
  if (bcx > a.x) return { x1: acx, y1: a.y + a.h, x2: bcx, y2: b.y, dir: 'v' };
  return { x1: acx, y1: a.y, x2: bcx, y2: b.y + b.h, dir: 'vu' };
}

function edgeSVG(e, a, b, t, idx, nodes, placed) {
  const an = anchors(a, b);
  const { x1, y1, x2, y2, dir } = an;
  const gap = 10;
  let ex = x2, ey = y2, d;
  if (dir === 'h') {
    ex = x2 - gap;
    const dx = Math.max(24, Math.min(70, (ex - x1) * 0.45));
    d = `M${x1} ${y1} C${x1 + dx} ${y1}, ${ex - dx} ${y2}, ${ex} ${y2}`;
  } else if (dir === 'hl') {
    ex = x2 + gap;
    const dx = Math.max(24, Math.min(70, (x1 - ex) * 0.45));
    d = `M${x1} ${y1} C${x1 - dx} ${y1}, ${ex + dx} ${y2}, ${ex} ${y2}`;
  } else if (dir === 'v') {
    ey = y2 - gap;
    const dy = Math.max(20, Math.min(56, (ey - y1) * 0.45));
    d = `M${x1} ${y1} C${x1} ${y1 + dy}, ${x2} ${ey - dy}, ${x2} ${ey}`;
  } else {
    ey = y2 + gap;
    const dy = Math.max(20, Math.min(56, (y1 - ey) * 0.45));
    d = `M${x1} ${y1} C${x1} ${y1 - dy}, ${x2} ${ey + dy}, ${x2} ${ey}`;
  }
  const primary = !!e.primary;
  const stroke = primary ? 'url(#primary)' : t.lineStrong;
  const dash = e.dashed ? ' stroke-dasharray="6 5"' : '';
  const halo = primary
    ? `<path d="${d}" fill="none" stroke="url(#primary)" stroke-width="6" opacity="0.28" filter="url(#glow)"/>` : '';
  let label = '';
  if (e.label) {
    const fs = 11.5, lw = textW(e.label, fs) + 18, lh = 22;
    const mx = (x1 + ex) / 2, my = (y1 + ey) / 2;
    // 双轴候选：先沿连线中点上下避让，再左右挪到线侧，最后组合
    const cand = [];
    for (const dx of [0, 50, -50, 84, -84, 116, -116, 150, -150, 190, -190]) {
      for (const dy of [0, -28, 28, -56, 56, -84, 84, -112, 112]) cand.push([dx, dy]);
    }
    const hits = (box) => {
      if (box.l < 2 || box.t < 2) return true;
      for (const n of (nodes || [])) {
        const ow = Math.min(box.r, n.x + n.w) - Math.max(box.l, n.x);
        const oh = Math.min(box.b, n.y + n.h) - Math.max(box.t, n.y);
        if (ow > -4 && oh > -4) return true;
      }
      for (const p of (placed || [])) {
        const ow = Math.min(box.r, p.r) - Math.max(box.l, p.l);
        const oh = Math.min(box.b, p.b) - Math.max(box.t, p.t);
        if (ow > 2 && oh > 2) return true;
      }
      return false;
    };
    let off = null;
    for (const [dx, dy] of cand) {
      const cx = mx + dx, box = { l: cx - lw / 2, t: my - lh / 2 + dy, r: cx + lw / 2, b: my + lh / 2 + dy };
      if (!hits(box)) { off = [dx, dy, cx]; placed.push(box); break; }
    }
    if (!off) off = [0, 0, mx]; // 兜底：即使拥挤也保留全部标签
    const [dx, dy, lx] = off;
    label = `<g><rect x="${lx - lw / 2}" y="${my - lh / 2 + dy}" width="${lw}" height="${lh}" rx="7" fill="${t.labelBg}" stroke="${t.border}"/>`
      + `<text x="${lx}" y="${my + 4 + dy}" font-size="${fs}" font-weight="600" fill="${t.labelInk}" text-anchor="middle">${esc(e.label)}</text></g>`;
  }
  return `<g>${halo}<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${primary ? 2.8 : 1.9}"${dash} marker-end="${primary ? 'url(#arrow-p)' : 'url(#arrow)'}"/>${label}</g>`;
}

function laneSVG(group, nodes, t) {
  if (!nodes.length) return '';
  const tone = TONE[group.tone] || TONE.blue;
  const minX = Math.min(...nodes.map(n => n.x)) - 26;
  const maxX = Math.max(...nodes.map(n => n.x + n.w)) + 26;
  const minY = Math.min(...nodes.map(n => n.y)) - 34;
  const maxY = Math.max(...nodes.map(n => n.y + n.h)) + 22;
  return `<g>
    <rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" rx="18"
      fill="${t.lane}" stroke="${t.laneBorder}" stroke-width="1.4" stroke-dasharray="7 6"/>
    <g transform="translate(${minX + 16},${minY + 2})">
      <rect x="0" y="-11" width="${textW(group.label, 11.5) + 30}" height="23" rx="7" fill="${t.bg}" stroke="${hexA(tone, 0.5)}"/>
      <circle cx="11" cy="0" r="3.5" fill="${tone}"/>
      <text x="20" y="4" font-size="11.5" font-weight="700" letter-spacing="1" fill="${tone}">${esc(group.label)}</text>
    </g>
  </g>`;
}

function zoneSVG(z, nodes, t) {
  if (!nodes.length) return '';
  const tone = TONE[z.tone] || TONE.cyan;
  const minX = Math.min(...nodes.map(n => n.x)) - 30;
  const maxX = Math.max(...nodes.map(n => n.x + n.w)) + 30;
  const minY = Math.min(...nodes.map(n => n.y)) - 38;
  const maxY = Math.max(...nodes.map(n => n.y + n.h)) + 26;
  return `<g>
    <rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" rx="20"
      fill="${hexA(tone, 0.05)}" stroke="${hexA(tone, 0.55)}" stroke-width="1.6" stroke-dasharray="9 6"/>
    <g transform="translate(${minX + 18},${minY + 2})">
      <rect x="0" y="-12" width="${textW(z.label, 12) + 34}" height="24" rx="8" fill="${t.bg}" stroke="${hexA(tone, 0.6)}"/>
      <circle cx="12" cy="0" r="4" fill="${tone}"/>
      <text x="22" y="4" font-size="12" font-weight="700" letter-spacing="0.8" fill="${tone}">${esc(z.label)}</text>
    </g>
  </g>`;
}

// 按给定 cfg 计算布局并生成正文 SVG；两阶段调用：先量自然尺寸，再按目标画幅铺开。
function renderBody(spec, cfg, t, type) {
  const theme = cfg.theme;
  let body = '', bodyBottom = 0, usedKinds = [], audit;

  if (type === 'sequence') {
    const L = layoutSequence(spec, cfg);
    const { parts, msgs, W, H } = L;
    // 生命线
    parts.forEach(p => {
      body += `<line x1="${p.cx}" y1="${p.y + p.h}" x2="${p.cx}" y2="${L.lifeBottom}" stroke="${t.borderStrong}" stroke-width="1.4" stroke-dasharray="5 6"/>`;
    });
    parts.forEach(p => {
      const kind = kindOf(p), meta = KIND[kind];
      body += `<g><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="11" fill="${t.card}" stroke="${borderOf(meta.color, t)}" stroke-width="1.5" filter="url(#shadow)"/>`
        + `<rect x="${p.x}" y="${p.y + 10}" width="3.5" height="${p.h - 20}" rx="1.75" fill="${meta.color}"/>`
        + `<rect x="${p.x + 14}" y="${p.y + 15}" width="28" height="28" rx="8" fill="${theme === 'light' ? meta.soft : hexA(meta.color, 0.14)}"/>`
        + iconSVG(kind, p.x + 28, p.y + 29, meta.color)
        + `<text x="${p.x + 52}" y="${p.y + 25}" font-size="14.5" font-weight="650" fill="${t.ink}">${esc(p.label || p.id)}</text>`
        + (p.sub ? `<text x="${p.x + 52}" y="${p.y + 43}" font-size="11" fill="${t.sub}">${esc(p.sub)}</text>` : '')
        + `</g>`;
    });
    const idx = new Map(parts.map(p => [p.id, p]));
    msgs.forEach((m, i) => {
      const a = idx.get(m.from), b = idx.get(m.to);
      if (!a || !b) return;
      const self = a.id === b.id;
      const y = m.y;
      const isReturn = m.type === 'return' || m.type === 'dash';
      const marker = isReturn ? 'url(#arrow-open)' : 'url(#arrow)';
      const dash = isReturn ? ' stroke-dasharray="6 5"' : '';
      let path, anchorX;
      if (self) {
        const rx = a.cx + 74;
        path = `M${a.cx} ${y} H${rx - 16} C${rx + 14} ${y}, ${rx + 14} ${y + 34}, ${rx - 16} ${y + 34} H${a.cx + 8}`;
        anchorX = a.cx;
      } else {
        const fwd = b.cx > a.cx;
        const x1 = a.cx + (fwd ? 6 : -6), x2 = b.cx - (fwd ? 10 : -10);
        path = `M${x1} ${y} H${x2}`;
        anchorX = (x1 + x2) / 2;
      }
      body += `<g>
        <circle cx="26" cy="${y}" r="11" fill="${t.numberBg}" stroke="${t.border}"/>
        <text x="26" y="${y + 4}" font-size="10.5" font-weight="700" fill="${t.sub}" text-anchor="middle">${i + 1}</text>
        <path d="${path}" fill="none" stroke="${t.lineStrong}" stroke-width="1.9"${dash} marker-end="${marker}"/>
      </g>`;
      if (m.label) {
        const fs = 12, lw = textW(m.label, fs) + 20;
        body += `<g><rect x="${anchorX - lw / 2}" y="${y - 26}" width="${lw}" height="22" rx="7" fill="${t.labelBg}" stroke="${t.border}"/>`
          + `<text x="${anchorX}" y="${y - 10}" font-size="${fs}" font-weight="600" fill="${t.labelInk}" text-anchor="middle">${esc(m.label)}</text></g>`;
      }
    });
    bodyBottom = L.lifeBottom;
    usedKinds = [...new Set(parts.map(kindOf))];
    audit = auditLayout([], [], W, H);
    var naturalWidth = W;

  } else {
    const isFlow = type === 'flow';
    const L = layoutTiers(spec, cfg);
    const { nodes, byId, edges, W, H } = L;
    const placed = [];
    placed.push({ l: 0, t: 0, r: W, b: cfg.bodyTop - 8 });
    placed.push({ l: 0, t: H - 42, r: W, b: H });
    if (spec.groups) {
      spec.groups.forEach(g => {
        const members = nodes.filter(n => n.group === g.id);
        body += laneSVG(g, members, t);
        if (members.length) {
          const minX = Math.min(...members.map(n => n.x)) - 26;
          const minY = Math.min(...members.map(n => n.y)) - 34;
          placed.push({ l: minX + 10, t: minY - 13, r: minX + 16 + textW(g.label, 11.5) + 32, b: minY + 15 });
        }
      });
    }
    if (spec.zones) {
      spec.zones.forEach(z => {
        const members = nodes.filter(n => (n.zone || n.group) === z.id);
        body += zoneSVG(z, members, t);
        if (members.length) {
          const minX = Math.min(...members.map(n => n.x)) - 30;
          const minY = Math.min(...members.map(n => n.y)) - 38;
          placed.push({ l: minX + 12, t: minY - 15, r: minX + 18 + textW(z.label, 12) + 36, b: minY + 15 });
        }
      });
    }
    nodes.forEach(n => {
      const shape = isFlow ? (n.shape || 'process') : (type === 'deployment' ? (n.shape || 'process') : 'card');
      body += nodeSVG(n, t, shape);
    });
    edges.forEach((e, i) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (a && b) body += edgeSVG(e, a, b, t, i, nodes, placed);
    });
    bodyBottom = Math.max(...nodes.map(n => n.y + n.h)) + 18;
    usedKinds = [...new Set(nodes.map(kindOf))];
    audit = auditLayout(nodes, edges, W, H);
    var naturalWidth = W;
  }
  return { body, bodyBottom, usedKinds, audit, width: naturalWidth };
}

// ─── 主构建 ───────────────────────────────────────────────────
function buildSVG(spec, opts = {}) {
  const type = ['architecture', 'flow', 'sequence', 'deployment'].includes(spec.type) ? spec.type : 'architecture';
  const theme = spec.theme === 'dark' ? 'dark' : 'light';
  const t = THEMES[theme];
  const baseCfg = { pad: 56, minW: opts.minW || 1080, bodyTop: spec.subtitle ? 172 : 142, footH: 74, gapX: 92, gapY: 28, theme };

  const requested = opts.aspect !== undefined ? opts.aspect : spec.aspect;
  const aspect = requested === 'auto' ? null
    : (normalizeAspect(requested) || aspectFor(type));

  // 第一遍：自然尺寸
  const naturalCfg = { ...baseCfg };
  if (type === 'flow') naturalCfg.gapX = 140;
  const natural = renderBody(spec, naturalCfg, t, type);

  // 目标画幅：只放大画布，节点/文字保持原尺寸
  const fit = aspect
    ? fitCanvas(natural.width, natural.bodyBottom, aspect)
    : { width: natural.width, height: natural.bodyBottom, dx: 0, dy: 0 };
  const CW = fit.width, CH = fit.height;

  // 第二遍：按目标画幅重新铺开（增大间距，不缩放文字）
  const finalCfg = { ...baseCfg, targetW: CW, targetH: CH };
  if (type === 'flow') finalCfg.gapX = 140;
  const final = renderBody(spec, finalCfg, t, type);

  const headerH = spec.subtitle ? 142 : 112;
  const stageTop = headerH + 16, stageBottom = CH - 46;
  const bodyH = Math.max(1, final.bodyBottom - baseCfg.bodyTop);
  const stageH = Math.max(bodyH, stageBottom - stageTop);
  const dx = Math.round((CW - natural.width) / 2) || 0;
  const dy = Math.round(stageTop + (stageH - bodyH) / 2 - baseCfg.bodyTop);
  const innerW = CW - baseCfg.pad * 2;
  const svg = wrapSVG(CW, CH, t, defsSVG(CW, CH, t)
    + `<g transform="translate(${baseCfg.pad},0)">${headerSVG(spec, innerW, t)}</g>`
    + `<g transform="translate(${dx},${dy})">${final.body}</g>`
    + `<g transform="translate(${baseCfg.pad},0)">${footerSVG(spec, innerW, CH, t, final.usedKinds)}</g>`);

  return {
    svg, width: CW, height: CH, type,
    aspect: aspect || 'auto',
    audit: { ...final.audit, width: CW, height: CH },
  };
}

function wrapSVG(W, H, t, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif">
  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  ${content}
</svg>`;
}

module.exports = { buildSVG, THEMES, KIND, TONE, textW, wrapText };
