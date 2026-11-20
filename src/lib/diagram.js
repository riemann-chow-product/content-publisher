/**
 * diagram.js — Archify 风格静态图表渲染器
 *
 * 借鉴 https://github.com/tt-a1i/archify 的视觉语言，为微信公众号 / CSDN
 * 这类只能放静态图的平台输出 PNG：
 *   - 分层泳道（信任边界 / 分组），虚线框 + 组标题
 *   - 类型化节点卡片（client / service / db / cache / network / queue…）
 *   - 标准实心三角箭头 + 贝塞尔连线，主路径高亮（渐变 + 发光）+ 连线标签
 *   - 图例、标题 / 副标题 / 脚注、网格背景、明暗主题
 *
 * 输入是一份 typed JSON spec（与 Archify 的 IR 思路一致，但更轻量）：
 * {
 *   "title": "GroveMQ 接入层与转发层",
 *   "subtitle": "Mode A / Mode B",
 *   "badge": "ARCHITECTURE",
 *   "theme": "dark",              // dark | light
 *   "layout": "lanes",            // lanes(分组泳道) | row(单行流程) | column(单列)
 *   "groups": [{ "id": "access", "label": "接入层", "tone": "blue" }],
 *   "nodes": [
 *     { "id": "lb", "label": "L4 Service", "sub": "ClientIP 亲和",
 *       "kind": "network", "group": "access" }
 *   ],
 *   "edges": [{ "from": "lb", "to": "n1", "label": "CONNECT", "primary": true }],
 *   "footnote": "..."
 * }
 *
 * 渲染器内置「校验 + 自动修复」引擎（浏览器内执行，结果写入
 * window.__DIAGRAM_AUDIT__），规则包括：画布溢出、节点重叠、文字截断、
 * 连线长度、画布占比、标签互相重叠、标签压节点、标签与箭头距离、
 * 箭头与文字距离。任何一条不通过都不会产出坏图。
 *
 * 本模块只负责 spec -> HTML；截图由 generator.generateDiagram 完成。
 */
'use strict';

// ─── 节点类型（archify 风格语义色）────────────────────────────
const KIND = {
  client:   { color: '#58a6ff', label: '客户端 / 外部',  glyph: '○' },
  network:  { color: '#39c5cf', label: '网络 / 负载均衡', glyph: '⇄' },
  service:  { color: '#a371f7', label: '服务 / 计算',     glyph: '◆' },
  db:       { color: '#3fb950', label: '存储 / 数据库',   glyph: '▤' },
  cache:    { color: '#d29922', label: '缓存 / 中间件',   glyph: '⚡' },
  queue:    { color: '#f778ba', label: '消息 / 队列',     glyph: '≋' },
  external: { color: '#8b949e', label: '第三方 / 边界',   glyph: '◇' },
  default:  { color: '#79c0ff', label: '组件',           glyph: '▪' },
};

const TONE = {
  blue:   '#58a6ff',
  cyan:   '#39c5cf',
  violet: '#a371f7',
  green:  '#3fb950',
  amber:  '#d29922',
  pink:   '#f778ba',
  gray:   '#8b949e',
};

const THEME = {
  dark: {
    bg: '#0b0e14',
    bgGrad: 'radial-gradient(1100px 620px at 12% -10%, rgba(88,166,255,0.10), transparent 60%), radial-gradient(900px 560px at 92% 110%, rgba(163,113,247,0.10), transparent 60%), #0b0e14',
    grid: 'rgba(255,255,255,0.035)',
    text: '#f0f6fc', sub: '#9aa5b1', muted: '#6e7681',
    card: 'rgba(255,255,255,0.035)', cardBorder: 'rgba(255,255,255,0.11)',
    lane: 'rgba(255,255,255,0.022)', laneBorder: 'rgba(255,255,255,0.13)',
    edge: 'rgba(154,165,177,0.45)', edgeStrong: 'rgba(201,209,217,0.78)', arrow: '#a9b4c0',
    labelBg: '#11161f', labelText: '#c9d1d9',
    legendBorder: 'rgba(255,255,255,0.10)',
  },
  light: {
    bg: '#f7f9fc',
    bgGrad: 'radial-gradient(1100px 620px at 12% -10%, rgba(88,166,255,0.12), transparent 60%), radial-gradient(900px 560px at 92% 110%, rgba(163,113,247,0.10), transparent 60%), #f7f9fc',
    grid: 'rgba(15,23,42,0.045)',
    text: '#1f2328', sub: '#57606a', muted: '#8b949e',
    card: 'rgba(255,255,255,0.92)', cardBorder: 'rgba(15,23,42,0.13)',
    lane: 'rgba(255,255,255,0.45)', laneBorder: 'rgba(15,23,42,0.16)',
    edge: 'rgba(87,96,106,0.55)', edgeStrong: 'rgba(61,68,77,0.82)', arrow: '#57606a',
    labelBg: '#ffffff', labelText: '#3d444d',
    legendBorder: 'rgba(15,23,42,0.12)',
  },
};

function escapeHTML(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJSON(value) {
  // 防止 spec 内容提前闭合 <script>
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * 校验并规范化 spec。抛出的错误带字段名，便于 CLI 直接展示。
 */
function normalizeSpec(raw) {
  let spec = raw;
  if (typeof raw === 'string') {
    try {
      spec = JSON.parse(raw);
    } catch (err) {
      throw new Error(`diagram spec 不是合法 JSON: ${err.message}`);
    }
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('diagram spec 必须是 JSON 对象');
  }
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    throw new Error('diagram spec.nodes 必须是非空数组');
  }

  const seen = new Set();
  const nodes = spec.nodes.map((n, i) => {
    if (!n || typeof n !== 'object') throw new Error(`nodes[${i}] 必须是对象`);
    const id = String(n.id || `n${i + 1}`);
    if (seen.has(id)) throw new Error(`节点 id 重复: ${id}`);
    seen.add(id);
    return {
      id,
      label: String(n.label || n.id || id),
      sub: String(n.sub || ''),
      kind: Object.prototype.hasOwnProperty.call(KIND, n.kind) ? n.kind : 'default',
      group: n.group == null ? null : String(n.group),
    };
  });

  const edges = (Array.isArray(spec.edges) ? spec.edges : []).map((e, i) => {
    if (!e || typeof e !== 'object') throw new Error(`edges[${i}] 必须是对象`);
    const from = String(e.from || '');
    const to = String(e.to || '');
    if (!seen.has(from)) throw new Error(`edges[${i}].from 引用了不存在的节点: ${from}`);
    if (!seen.has(to)) throw new Error(`edges[${i}].to 引用了不存在的节点: ${to}`);
    return {
      from, to,
      label: String(e.label || ''),
      primary: Boolean(e.primary),
      dashed: Boolean(e.dashed),
    };
  });

  const groups = (Array.isArray(spec.groups) ? spec.groups : []).map((g, i) => ({
    id: String((g && g.id) || `g${i + 1}`),
    label: String((g && g.label) || ''),
    tone: TONE[g && g.tone] ? g.tone : 'blue',
  }));

  const hasGroups = groups.length > 0;
  const layout = ['lanes', 'row', 'column'].includes(spec.layout)
    ? spec.layout
    : (hasGroups ? 'lanes' : 'row');

  return {
    title: String(spec.title || ''),
    subtitle: String(spec.subtitle || ''),
    badge: String(spec.badge || (spec.type === 'sequence' ? 'SEQUENCE' : 'ARCHITECTURE')),
    theme: spec.theme === 'light' ? 'light' : 'dark',
    layout,
    groups,
    nodes,
    edges,
    footnote: String(spec.footnote || ''),
    legend: spec.legend !== false,
  };
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function nodeHTML(n) {
  const k = KIND[n.kind];
  return `<div class="node" data-node="${escapeHTML(n.id)}" style="--kind:${k.color};--kind-soft:${hexToRgba(k.color, 0.16)}">
    <span class="node-glyph">${k.glyph}</span>
    <span class="node-body">
      <span class="node-label">${escapeHTML(n.label)}</span>
      ${n.sub ? `<span class="node-sub">${escapeHTML(n.sub)}</span>` : ''}
    </span>
  </div>`;
}

function laneHTML(group, nodes, index) {
  const tone = TONE[group.tone] || TONE.blue;
  const label = group.label || `分组 ${index + 1}`;
  return `<div class="lane" style="--tone:${tone}">
    <div class="lane-head"><span class="lane-dot"></span><span class="lane-label">${escapeHTML(label)}</span></div>
    <div class="lane-nodes">${nodes.map(nodeHTML).join('\n')}</div>
  </div>`;
}

function legendHTML(spec) {
  if (!spec.legend) return '';
  const kinds = [...new Set(spec.nodes.map(n => n.kind))];
  const items = kinds.map(k => {
    const meta = KIND[k];
    return `<span class="legend-item"><span class="legend-swatch" style="background:${meta.color}"></span>${escapeHTML(meta.label)}</span>`;
  }).join('');
  return `<div class="legend">${items}</div>`;
}

/**
 * 生成完整 HTML。布局由 CSS 决定，连线与标签在浏览器内测量后绘制 SVG，
 * 并跑一遍「校验 + 自动修复」，结果写入 window.__DIAGRAM_AUDIT__。
 */
function buildDiagramHTML(spec, opts = {}) {
  const s = normalizeSpec(spec);
  const t = THEME[s.theme];
  const width = opts.width || 1200;
  const height = opts.height || 675;
  const lanes = [];

  if (s.layout === 'row' || s.layout === 'column') {
    lanes.push(`<div class="lane lane--flat ${s.layout === 'column' ? 'lane--column' : ''}">${s.nodes.map(nodeHTML).join('\n')}</div>`);
  } else {
    const grouped = new Map();
    const loose = [];
    for (const g of s.groups) grouped.set(g.id, []);
    for (const n of s.nodes) {
      if (n.group && grouped.has(n.group)) grouped.get(n.group).push(n);
      else loose.push(n);
    }
    s.groups.forEach((g, i) => {
      const members = grouped.get(g.id) || [];
      if (members.length) lanes.push(laneHTML(g, members, i));
    });
    if (loose.length) {
      lanes.push(laneHTML({ id: '__loose__', label: '其他组件', tone: 'gray' }, loose, s.groups.length));
    }
  }

  const edgesJSON = safeJSON(s.edges);
  const arrowColor = t.arrow;

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${width}px; height:${height}px; overflow:hidden; }
  body {
    background:${t.bgGrad};
    font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif;
    color:${t.text}; position:relative;
  }
  body::before {
    content:''; position:absolute; inset:0; pointer-events:none;
    background-image:linear-gradient(${t.grid} 1px,transparent 1px),linear-gradient(90deg,${t.grid} 1px,transparent 1px);
    background-size:32px 32px;
  }
  .frame { position:absolute; inset:0; display:flex; flex-direction:column; padding:34px 40px 26px; }
  .head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; flex:none; }
  .title { font-size:29px; font-weight:700; letter-spacing:.3px; line-height:1.3; }
  .subtitle { margin-top:8px; font-size:15px; color:${t.sub}; font-weight:400; }
  .badge {
    flex:none; margin-top:4px; font-size:11px; font-weight:700; letter-spacing:2px;
    color:${t.sub}; border:1px solid ${t.legendBorder}; border-radius:6px;
    padding:6px 12px; text-transform:uppercase;
  }
  .stage { position:relative; flex:1; min-height:0; display:flex; align-items:center; justify-content:center; margin:22px 0 16px; }
  .stage-inner { display:flex; align-items:center; justify-content:center; gap:var(--stage-gap,26px); transform-origin:center center; }
  .edges { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible; }
  .lane {
    position:relative; z-index:1; flex:0 0 auto; min-width:190px; max-width:100%;
    background:${t.lane}; border:1px dashed ${t.laneBorder}; border-radius:16px;
    padding:var(--lane-pad,16px) var(--lane-pad,16px) calc(var(--lane-pad,16px) + 2px); display:flex; flex-direction:column; gap:var(--lane-gap,14px);
  }
  .lane-head { display:flex; align-items:center; gap:8px; margin-bottom:2px; }
  .lane-dot { width:8px; height:8px; border-radius:50%; background:var(--tone); box-shadow:0 0 12px var(--tone); flex:none; }
  .lane-label { font-size:12px; font-weight:700; letter-spacing:1.2px; color:var(--tone); text-transform:uppercase; }
  .lane-nodes { display:flex; flex-direction:column; gap:var(--node-gap,26px); }
  .lane--flat { border:none; background:transparent; padding:0; flex-direction:row; align-items:center; gap:var(--flat-gap,46px); min-width:0; }
  .lane--flat .lane-head { display:none; }
  .lane--flat.lane--column { flex-direction:column; gap:var(--col-gap,20px); }
  .node {
    position:relative; display:flex; align-items:center; gap:12px;
    min-width:172px; max-width:var(--node-maxw,250px); padding:var(--node-pad,13px) 16px;
    background:${t.card}; border:1px solid ${t.cardBorder}; border-radius:12px;
    box-shadow:0 6px 22px rgba(0,0,0,0.18); overflow:hidden;
  }
  .node::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--kind); border-radius:12px 0 0 12px; }
  .node-glyph {
    flex:none; width:30px; height:30px; border-radius:8px; display:flex; align-items:center; justify-content:center;
    background:var(--kind-soft); color:var(--kind); font-size:16px; line-height:1;
  }
  .node-body { display:flex; flex-direction:column; gap:3px; min-width:0; }
  .node-label { font-size:var(--label-size,15px); font-weight:600; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .node-sub { font-size:var(--sub-size,11.5px); color:${t.sub}; line-height:1.4; }
  .foot { flex:none; display:flex; align-items:center; justify-content:space-between; gap:20px; border-top:1px solid ${t.legendBorder}; padding-top:14px; }
  .legend { display:flex; flex-wrap:wrap; gap:8px 18px; }
  .legend-item { display:flex; align-items:center; gap:7px; font-size:11.5px; color:${t.sub}; }
  .legend-swatch { width:9px; height:9px; border-radius:3px; }
  .footnote { font-size:11px; color:${t.muted}; text-align:right; max-width:44%; line-height:1.5; }
</style></head>
<body>
<div class="frame">
  <div class="head">
    <div>
      ${s.title ? `<div class="title">${escapeHTML(s.title)}</div>` : ''}
      ${s.subtitle ? `<div class="subtitle">${escapeHTML(s.subtitle)}</div>` : ''}
    </div>
    ${s.badge ? `<div class="badge">${escapeHTML(s.badge)}</div>` : ''}
  </div>
  <div class="stage" id="stage">
    <svg class="edges" id="edges" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="stage-inner" id="stage-inner">${lanes.join('\n')}</div>
  </div>
  <div class="foot">
    ${legendHTML(s)}
    ${s.footnote ? `<div class="footnote">${escapeHTML(s.footnote)}</div>` : ''}
  </div>
</div>
<script>
(function () {
  var EDGES = ${edgesJSON};
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.getElementById('edges');
  var stage = document.getElementById('stage');
  var inner = document.getElementById('stage-inner');
  if (!svg || !stage || !inner) return;

  var W = ${width}, H = ${height};
  var ROOT = document.documentElement;
  var arrowGap = 8;             // 箭头尖端到目标节点边缘的距离
  var ARROW_MIN_DIST = 12;      // 文字与箭头的最小距离
  var LABEL_MIN_DIST = 12;      // 连线标签与箭头的最小距离
  var LABEL_TEXT_MIN_DIST = 8;  // 连线标签与任意文字的最小距离
  function setv(k, v) { ROOT.style.setProperty(k, v); }
  function getv(k, d) { var v = parseFloat(getComputedStyle(ROOT).getPropertyValue(k)); return isNaN(v) ? d : v; }
  function R(sel) { return [].slice.call(document.querySelectorAll(sel)).map(function (e) { return e.getBoundingClientRect(); }); }
  // 所有"纯文字"元素：泳道标题、主/副标题、角标、脚注、图例、节点文字。
  // 之前只避让 .node 卡片，导致标签压在「转发层 / Cluster」这类泳道标题上。
  function ALL_TEXT() {
    return R('.lane-label').concat(R('.lane-head'), R('.title'), R('.subtitle'),
      R('.badge'), R('.footnote'), R('.legend-item'), R('.node-label'), R('.node-sub'));
  }
  function toLocal(r) {
    return { left:r.left-geo.sb.left, top:r.top-geo.sb.top,
             right:r.right-geo.sb.left, bottom:r.bottom-geo.sb.top };
  }
  function inter(a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return (w > 1 && h > 1) ? Math.round(w * h) : 0;
  }
  function gap(a, b) {
    var dx = Math.max(0, a.left - b.right, b.left - a.right);
    var dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function union(list) {
    if (!list.length) return null;
    return list.reduce(function (acc, r) {
      return { left:Math.min(acc.left,r.left), top:Math.min(acc.top,r.top),
               right:Math.max(acc.right,r.right), bottom:Math.max(acc.bottom,r.bottom) };
    }, { left:1e9, top:1e9, right:-1e9, bottom:-1e9 });
  }
  function bez(p0,p1,p2,p3,t) { var u=1-t; return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3; }

  // 几何：起点 / 控制点 / 终点 / 箭头尖端占位框
  function geometry() {
    var sb = stage.getBoundingClientRect(), items = [];
    EDGES.forEach(function (e) {
      var a = document.querySelector('[data-node="' + e.from + '"]');
      var b = document.querySelector('[data-node="' + e.to + '"]');
      if (!a || !b) return;
      var ar=a.getBoundingClientRect(), br=b.getBoundingClientRect();
      var acx=ar.left+ar.width/2, bcx=br.left+br.width/2;
      var sameColumn = Math.abs(acx-bcx) < (ar.width+br.width)*0.3;
      var vertical = sameColumn && Math.abs(br.top-ar.top) > 8;
      var x1,y1,x2,y2,cx1,cy1,cx2,cy2;
      var goLeft = bcx < acx; // 目标在源节点左侧：必须从源左缘出发、到目标右缘结束
      if (vertical) {
        x1=acx-sb.left; y1=ar.bottom-sb.top+2;
        x2=bcx-sb.left; y2=br.top-sb.top-arrowGap;
        var dy=Math.max(4,Math.min(Math.abs(y2-y1)*0.42,48));
        cx1=x1; cy1=y1+dy; cx2=x2; cy2=y2-dy;
      } else {
        x1=(goLeft?ar.left:ar.right)-sb.left+(goLeft?-2:2); y1=ar.top+ar.height/2-sb.top;
        x2=(goLeft?br.right:br.left)-sb.left+(goLeft?arrowGap:-arrowGap); y2=br.top+br.height/2-sb.top;
        // 控制点必须随线长收敛，短边上强制 12px 会造成 cx1 > cx2 的回环
        var dx=Math.max(4,Math.min(Math.abs(x2-x1)*0.42,48));
        cx1=x1+(goLeft?-dx:dx); cy1=y1; cx2=x2+(goLeft?dx:-dx); cy2=y2;
      }
      items.push({ e:e, from:e.from, to:e.to, x1:x1,y1:y1,x2:x2,y2:y2,cx1:cx1,cy1:cy1,cx2:cx2,cy2:cy2,
        d:'M '+x1+' '+y1+' C '+cx1+' '+cy1+', '+cx2+' '+cy2+', '+x2+' '+y2,
        len:Math.abs(x2-x1)+Math.abs(y2-y1),
        arrowBox:{ left:x2-6, top:y2-6, right:x2+6, bottom:y2+6 } });
    });
    return { sb:sb, items:items };
  }

  function validate(geo) {
    var checks = {}, nodeR = R('.node');
    var content = union(nodeR.concat(R('.lane')));
    var frameR = R('.head').concat(R('.foot'));
    var outside = 0;
    nodeR.concat(frameR).forEach(function (r) {
      if (r.left < -1 || r.top < -1 || r.right > W+1 || r.bottom > H+1) outside++;
    });
    checks.canvasOverflow = { ok:outside===0, detail:outside+' elements outside canvas' };

    var ov=0;
    for (var i=0;i<nodeR.length;i++) for (var j=i+1;j<nodeR.length;j++) if (inter(nodeR[i],nodeR[j])) ov++;
    checks.nodeOverlap = { ok:ov===0, detail:ov+' overlapping node pairs' };

    var clipped=[];
    [].slice.call(document.querySelectorAll('.node')).forEach(function (n) {
      ['.node-label','.node-sub'].forEach(function (sel) {
        var el=n.querySelector(sel);
        if (el && el.scrollWidth > el.clientWidth+1) clipped.push(n.dataset.node+sel);
      });
    });
    checks.textClipped = { ok:clipped.length===0, detail:clipped.join(',')||'none' };

    var short=geo.items.filter(function(g){return g.len<8;}).length;
    checks.edgeLength = { ok:short===0, detail:short+' zero/short edges' };

    var cw=content?(content.right-content.left)/geo.sb.width:0;
    var ch=content?(content.bottom-content.top)/geo.sb.height:0;
    checks.canvasRatio = { ok:cw<=0.90 && ch<=0.88, detail:'w='+cw.toFixed(2)+' h='+ch.toFixed(2) };
    checks._ratios={w:cw,h:ch};
    checks._fill=Math.max(cw,ch);
    checks._content=content;
    checks._stage={w:geo.sb.width,h:geo.sb.height};
    checks._nodeLocal=nodeR.map(function(r){
      return {left:r.left-geo.sb.left,top:r.top-geo.sb.top,right:r.right-geo.sb.left,bottom:r.bottom-geo.sb.top};
    });
    return checks;
  }

  // ── 自动修复（核心布局规则）──
  var repairs=[], checks={}, geo=null, rounds=0;
  var KEYS=['canvasOverflow','nodeOverlap','textClipped','edgeLength','canvasRatio'];
  function coreOk(){ return KEYS.every(function(k){ return checks[k] && checks[k].ok; }); }

  var preGeo=geometry(), preChk=validate(preGeo);
  if (preChk._fill < 0.45) {
    var kk=Math.min(1.35,1+(0.45-preChk._fill)*0.45);
    inner.style.transform='scale('+kk+')';
    setv('--stage-scale',kk);
    repairs.push('fill-scale->'+kk.toFixed(2));
  }

  for (var r=0;r<8;r++) {
    rounds=r+1;
    geo=geometry(); checks=validate(geo);
    if (coreOk()) break;
    var acted=false;
    if (!checks.textClipped.ok) {
      var fs=getv('--label-size',15);
      if (fs>10) { setv('--label-size',(fs-1)+'px'); repairs.push('label-size->'+(fs-1)); acted=true; }
      else { var mw=getv('--node-maxw',250);
             if (mw<360) { setv('--node-maxw',(mw+30)+'px'); repairs.push('node-maxw->'+(mw+30)); acted=true; } }
    }
    if (!checks.canvasOverflow.ok || !checks.nodeOverlap.ok || !checks.canvasRatio.ok) {
      var flat=getv('--flat-gap',46), hasFlat=!!document.querySelector('.lane--flat');
      // 间距不能压到只剩箭头长度，否则横线没有存在感；超宽时改用整体缩放
      if (hasFlat && flat>38) { setv('--flat-gap',(flat-8)+'px'); repairs.push('flat-gap->'+(flat-8)); acted=true; }
      else {
        var k=getv('--stage-scale',1);
        if (k>0.72) { var nk=Math.max(0.72,k-0.07); inner.style.transform='scale('+nk+')';
                       setv('--stage-scale',nk); repairs.push('scale->'+nk.toFixed(2)); acted=true; }
      }
    }
    if (!acted) break;
  }

  // ── 重绘：标准实心三角箭头 + 网格搜索标签避让 ──
  function makeDefs() {
    var d=document.createElementNS(NS,'defs');
    d.innerHTML =
      // 水平路径 bbox 高度=0，objectBoundingBox 渐变会整条不渲染；
      // 改用 userSpaceOnUse 覆盖整个 stage 宽度。
      '<linearGradient id="primary" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="'+geo.sb.width+'" y2="0">' +
        '<stop offset="0%" stop-color="#58a6ff"/><stop offset="100%" stop-color="#a371f7"/></linearGradient>' +
      // 水平路径 bbox 高度=0，objectBoundingBox 单位的滤镜区域会塌成 0 高，
      // Chromium 会连 marker-end 一起裁掉 —— 所以滤镜只给独立的发光底线用。
      '<filter id="glow" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000">' +
        '<feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      // 箭头只在终点：marker-end + orient=auto，尖端 (12,5) 由 refX=12 对齐到路径终点。
      '<marker id="arrow" viewBox="0 0 12 10" refX="12" refY="5" markerWidth="12" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">' +
        '<path d="M 0 0 L 12 5 L 0 10 L 3 5 z" fill="${arrowColor}"/></marker>' +
      '<marker id="arrow-primary" viewBox="0 0 12 10" refX="12" refY="5" markerWidth="12" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">' +
        '<path d="M 0 0 L 12 5 L 0 10 L 3 5 z" fill="#a371f7"/></marker>';
    return d;
  }

  function placeLabels(fontSize) {
    [].slice.call(svg.querySelectorAll('g.edge-label')).forEach(function(x){x.remove();});
    var placed=[], hits={label:0,node:0,arrow:0,text:0}, unplaced=0;
    var TS=[0.5,0.35,0.65,0.25,0.75];
    var DXS=[0,-40,40,-80,80,-120,120,-160,160];
    var DYS=[0,-20,20,-40,40,-64,64,-88,88,-112,112];
    var ARROWS=geo.items.map(function(g){return g.arrowBox;});
    // 所有文字（含泳道标题）都是障碍：标签不能压在任何文字上
    var TEXT_LOCAL=ALL_TEXT().map(toLocal);
    geo.items.forEach(function(g){
      if (!g.e.label) return;
      var group=document.createElementNS(NS,'g'); group.setAttribute('class','edge-label');
      var line=document.createElementNS(NS,'line');
      var bg=document.createElementNS(NS,'rect');
      var tx=document.createElementNS(NS,'text');
      tx.setAttribute('font-size',fontSize);
      tx.setAttribute('font-family',"-apple-system,'PingFang SC',sans-serif");
      tx.setAttribute('fill','${t.labelText}');
      tx.setAttribute('text-anchor','middle');
      tx.textContent=g.e.label;
      group.appendChild(line); group.appendChild(bg); group.appendChild(tx);
      svg.appendChild(group);
      var tw=tx.getComputedTextLength()+16, th=fontSize+10;
      var chosen=null;
      search:
      for (var ti=0;ti<TS.length;ti++) {
        var t=TS[ti];
        var bx=bez(g.x1,g.cx1,g.cx2,g.x2,t), by=bez(g.y1,g.cy1,g.cy2,g.y2,t);
        for (var di=0;di<DXS.length;di++) for (var yi=0;yi<DYS.length;yi++) {
          var mx=bx+DXS[di], my=by+DYS[yi];
          var box={left:mx-tw/2,top:my-th/2,right:mx+tw/2,bottom:my+th/2};
          if (box.left<4||box.top<4||box.right>geo.sb.width-4||box.bottom>geo.sb.height-4) continue;
          if (placed.some(function(q){return inter(box,q);})) { hits.label++; continue; }
          if (checks._nodeLocal.some(function(q){return inter(box,q);})) { hits.node++; continue; }
          if (TEXT_LOCAL.some(function(q){return gap(box,q)<LABEL_TEXT_MIN_DIST;})) { hits.text++; continue; }
          if (ARROWS.some(function(q){return gap(box,q)<LABEL_MIN_DIST;})) { hits.arrow++; continue; }
          chosen={box:box,mx:mx,my:my,bx:bx,by:by}; break search;
        }
      }
      if (!chosen) { unplaced++; group.remove(); return; }
      bg.setAttribute('x',chosen.box.left); bg.setAttribute('y',chosen.box.top);
      bg.setAttribute('width',tw); bg.setAttribute('height',th);
      bg.setAttribute('rx',6); bg.setAttribute('fill','${t.labelBg}');
      bg.setAttribute('stroke','${t.legendBorder}'); bg.setAttribute('stroke-width','1');
      tx.setAttribute('x',chosen.mx); tx.setAttribute('y',chosen.my+fontSize*0.35);
      var dist=Math.sqrt(Math.pow(chosen.mx-chosen.bx,2)+Math.pow(chosen.my-chosen.by,2));
      if (dist>30) {
        line.setAttribute('x1',chosen.bx); line.setAttribute('y1',chosen.by);
        line.setAttribute('x2',chosen.mx); line.setAttribute('y2',chosen.my);
        line.setAttribute('stroke','${t.edge}'); line.setAttribute('stroke-width','1');
        line.setAttribute('stroke-dasharray','3 3'); line.setAttribute('opacity','0.55');
      }
      placed.push(chosen.box);
    });
    return {unplaced:unplaced,hits:hits};
  }

  function redraw() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox','0 0 '+geo.sb.width+' '+geo.sb.height);
    svg.appendChild(makeDefs());
    geo.items.forEach(function(g){
      // 发光底线：挂 filter，但绝不带 marker（否则 bbox 高度=0 时会把箭头裁掉）
      if (g.e.primary) {
        var halo=document.createElementNS(NS,'path');
        halo.setAttribute('d',g.d); halo.setAttribute('fill','none');
        halo.setAttribute('stroke','url(#primary)');
        halo.setAttribute('stroke-width','5'); halo.setAttribute('opacity','0.45');
        halo.setAttribute('filter','url(#glow)');
        svg.appendChild(halo);
      }
      var p=document.createElementNS(NS,'path');
      p.setAttribute('class','edge-path');
      p.setAttribute('d',g.d); p.setAttribute('fill','none');
      p.setAttribute('stroke',g.e.primary?'url(#primary)':'${t.edgeStrong}');
      p.setAttribute('stroke-width',g.e.primary?'3':'2.2');
      p.setAttribute('stroke-dasharray',g.e.dashed?'6 5':'none');
      p.setAttribute('marker-end',g.e.primary?'url(#arrow-primary)':'url(#arrow)');
      svg.appendChild(p);
    });
    var lr=placeLabels(11);
    if (lr.unplaced>0) { repairs.push('label-font->9'); lr=placeLabels(9); }
    if (lr.unplaced>0) { repairs.push('label-font->8'); lr=placeLabels(8); }
    return lr;
  }

  // 结构校验：每条边都必须有一条带 marker 的路径，且该路径不能被 filter 裁掉。
  // Chromium 下 path 挂 filter 且 bbox 高/宽为 0 时，marker-end 会被一起裁掉，
  // 表现为「有些箭头缺失」（通常恰好是 primary 边）。
  function arrowRenderAudit() {
    // marker id 由 makeDefs() 固定定义，直接按白名单校验引用，
    // 不依赖同步解析阶段的 document.getElementById 索引。
    var MARKER_IDS = { 'arrow':true, 'arrow-primary':true };
    var paths=[].slice.call(svg.querySelectorAll('path.edge-path'));
    var missing=0, filtered=0, badRef=0;
    paths.forEach(function(p){
      var ref=p.getAttribute('marker-end');
      if (!ref) { missing++; return; }
      // 带 marker 的路径绝不能挂 filter，否则 bbox 为 0 时箭头会被裁掉
      if (p.getAttribute('filter')) filtered++;
      // 不用正则：整段脚本位于 JS 模板字面量内，反斜杠会被吞掉。
      var id = '';
      if (ref.indexOf('url(') === 0) {
        id = ref.slice(4).replace(/[)'"]+$/, '').replace(/^['"]?#/, '');
      }
      if (!MARKER_IDS[id]) badRef++;
    });
    return { count:paths.length, expected:geo.items.length,
             inDom:svg.getElementsByTagName('marker').length,
             missing:missing, filtered:filtered, badRef:badRef };
  }

  // 方向校验：箭头（marker-end）必须贴着目标节点，绝不能落在起点一侧。
  function arrowDirectionAudit() {
    var bad=0, self=0;
    geo.items.forEach(function(g){
      if (g.from === g.to) { self++; return; }
      var target=document.querySelector('[data-node="'+g.to+'"]');
      if (!target) { bad++; return; }
      var r=target.getBoundingClientRect();
      var left=r.left-geo.sb.left, right=r.right-geo.sb.left;
      var top=r.top-geo.sb.top, bottom=r.bottom-geo.sb.top;
      var d=Math.min(
        Math.abs(g.x2-left), Math.abs(g.x2-right),
        Math.abs(g.y2-top), Math.abs(g.y2-bottom)
      );
      if (d > arrowGap+8) bad++;
    });
    return { ok:bad===0, detail:bad+' arrows not at target end ('+self+' self messages skipped)' };
  }

  // 距离校验：箭头 ↔ 所有文字；标签 ↔ 所有箭头
  function arrowTextAudit() {
    // 泳道标题、标题/副标题、图例、脚注、节点文字、连线标签，一个都不能被箭头压住
    var textR=ALL_TEXT().concat(R('#edges g.edge-label rect')).map(toLocal);
    var minD=Infinity, bad=0;
    geo.items.forEach(function(g){
      textR.forEach(function(tr){ var d=gap(g.arrowBox,tr); if(d<minD)minD=d; if(d<ARROW_MIN_DIST)bad++; });
    });
    return {bad:bad,minD:minD===Infinity?-1:minD};
  }
  function labelArrowAudit() {
    var boxes=R('#edges g.edge-label rect').map(toLocal);
    var minD=Infinity, bad=0;
    geo.items.forEach(function(g){
      boxes.forEach(function(b){ var d=gap(g.arrowBox,b); if(d<minD)minD=d; if(d<LABEL_MIN_DIST)bad++; });
    });
    return {bad:bad,minD:minD===Infinity?-1:minD};
  }
  // 结果校验：标签与任意文字（尤其泳道标题）不得重叠或贴太近
  function labelTextAudit() {
    var boxes=R('#edges g.edge-label rect').map(toLocal);
    var texts=ALL_TEXT().map(toLocal);
    var minD=Infinity, bad=0;
    boxes.forEach(function(b){
      texts.forEach(function(q){ var d=gap(b,q); if(d<minD)minD=d; if(d<LABEL_TEXT_MIN_DIST)bad++; });
    });
    return {bad:bad,minD:minD===Infinity?-1:minD};
  }

  geo=geometry(); checks=validate(geo);
  var lr=redraw();
  var at=arrowTextAudit();
  for (var ai=0; ai<3 && at.bad>0; ai++) {
    arrowGap+=6; repairs.push('arrow-gap->'+arrowGap);
    geo=geometry(); checks=validate(geo);
    lr=redraw(); at=arrowTextAudit();
  }
  var la=labelArrowAudit();
  var lt=labelTextAudit();
  var ar=arrowRenderAudit();
  var ad=arrowDirectionAudit();

  checks.arrowRendered = { ok:ar.count===ar.expected && ar.missing===0 && ar.filtered===0 && ar.badRef===0,
    detail:ar.count+'/'+ar.expected+' arrow paths ('+ar.inDom+' markers in DOM), '+ar.missing+' missing marker, '+ar.filtered+' filtered, '+ar.badRef+' bad ref' };
  checks.arrowAtTarget = ad;
  checks.labelOverlap = { ok:lr.unplaced===0, detail:lr.unplaced+' unplaced, '+lr.hits.label+' label-label hits' };
  checks.labelNodeClearance = { ok:lr.unplaced===0, detail:lr.unplaced+' unplaced, '+lr.hits.node+' label-node hits' };
  checks.labelTextClearance = { ok:lt.bad===0 && lr.unplaced===0,
    detail:lt.bad+' labels too close to text ('+lr.hits.text+' candidates rejected), min distance='+(lt.minD<0?'n/a':lt.minD.toFixed(1)+'px') };
  checks.labelArrowClearance = { ok:la.bad===0 && lr.unplaced===0,
    detail:la.bad+' labels too close to arrows, min distance='+(la.minD<0?'n/a':la.minD.toFixed(1)+'px') };
  checks.arrowClearance = { ok:at.bad===0,
    detail:at.bad+' arrow/text conflicts, min distance='+(at.minD<0?'n/a':at.minD.toFixed(1)+'px') };

  var finalChecks={};
  Object.keys(checks).forEach(function(k){ if(k.charAt(0)!=='_') finalChecks[k]=checks[k]; });
  var passed=Object.keys(finalChecks).every(function(k){return finalChecks[k].ok;});

  window.__DIAGRAM_AUDIT__ = {
    passed:passed, rounds:rounds, scale:getv('--stage-scale',1),
    arrowGap:arrowGap, ratios:checks._ratios,
    contentBox:checks._content?{ left:checks._content.left,top:checks._content.top,
      right:checks._content.right,bottom:checks._content.bottom,
      width:checks._content.right-checks._content.left,
      height:checks._content.bottom-checks._content.top }:null,
    stageBox:checks._stage, repairs:repairs, checks:finalChecks
  };
})();
</script>
</body></html>`;
}

module.exports = {
  KIND,
  TONE,
  normalizeSpec,
  buildDiagramHTML,
  escapeHTML,
};
