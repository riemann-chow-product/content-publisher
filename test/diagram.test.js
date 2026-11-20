/**
 * diagram.test.js — Archify 风格静态图渲染器回归测试
 *
 * 纯函数部分零依赖；端到端部分需要 playwright + Chromium，
 * 不可用时自动 skip，保证 `npm test` 在任意环境都能跑。
 *
 * 重点覆盖用户反馈过的三类缺陷：
 *   1. 标准箭头不与文字重叠、文字与箭头保持距离
 *   2. 连线标签不互相重叠、不压节点、不压箭头、不压泳道标题
 *   3. 每条边的箭头都必须真实渲染（primary 边曾因 filter 裁掉 marker 而缺失）
 *   4. 画布占比 / 节点重叠 / 文字截断的校验与自动修复
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeSpec, buildDiagramHTML, KIND } = require('../src/lib/diagram');

const SAMPLE = {
  title: '测试架构图',
  subtitle: 'unit',
  groups: [{ id: 'g1', label: '接入层', tone: 'cyan' }],
  nodes: [
    { id: 'a', label: 'Client', kind: 'client', group: 'g1' },
    { id: 'b', label: 'API', sub: 'gateway', kind: 'service', group: 'g1' },
  ],
  edges: [{ from: 'a', to: 'b', label: 'req', primary: true }],
};

// 压力样例：长文字 + 同泳道垂直边 + 多条带标签的边
const STRESS = {
  title: '压力测试：拥挤布局',
  subtitle: '长标签 / 垂直边 / 多箭头',
  layout: 'lanes',
  groups: [
    { id: 'edge', label: '接入层', tone: 'cyan' },
    { id: 'core', label: '转发层', tone: 'violet' },
    { id: 'state', label: '状态层', tone: 'green' },
  ],
  nodes: [
    { id: 'c', label: 'MQTT Client', sub: 'CONNACK 0x9C 可重定向', kind: 'client', group: 'edge' },
    { id: 'lb', label: 'L4 Service 负载均衡器', kind: 'network', group: 'edge' },
    { id: 'n1', label: 'Broker N1', sub: 'NodeLoadTable', kind: 'service', group: 'core' },
    { id: 'n2', label: 'Broker N2', sub: '$share 选点', kind: 'service', group: 'core' },
    { id: 'db', label: '订阅表 / 会话', sub: 'gob 全量复制', kind: 'db', group: 'state' },
  ],
  edges: [
    { from: 'c', to: 'lb', label: 'CONNECT', primary: true },
    { from: 'lb', to: 'n1', label: 'PublishForward 转发' },
    { from: 'n1', to: 'n2', label: 'shared_groups 共享组' },
    { from: 'n2', to: 'db', label: '恰好一次投递', dashed: true },
  ],
  footnote: '负载数据 stale 时自动降级 fan-out',
};

function requirePlaywright(t) {
  try {
    return require('playwright').chromium;
  } catch (err) {
    t.skip(`playwright 不可用，跳过渲染测试: ${err.message}`);
    return null;
  }
}

async function auditInBrowser(chromium, spec, width = 1200, height = 675) {
  const html = buildDiagramHTML(spec, { width, height });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent(html, { waitUntil: 'networkidle' });
  const r = await page.evaluate((textSel) => {
    const R = sel => [...document.querySelectorAll(sel)].map(e => e.getBoundingClientRect().toJSON());
    return {
      audit: window.__DIAGRAM_AUDIT__ || null,
      nodes: R('.node'),
      labelBoxes: R('#edges g.edge-label rect'),
      labelTexts: R('#edges g.edge-label text'),
      texts: R(textSel),
      markers: [...document.querySelectorAll('#edges marker')].map(m => ({
        units: m.getAttribute('markerUnits'), orient: m.getAttribute('orient'),
        refX: m.getAttribute('refX'), w: m.getAttribute('markerWidth'),
      })),
      paths: [...document.querySelectorAll('#edges path.edge-path')].map(p => p.getAttribute('d')),
    };
  }, ALL_TEXT_SEL);
  await browser.close();
  return { ...r, errors };
}

function inter(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return (w > 1 && h > 1) ? Math.round(w * h) : 0;
}

const ALL_TEXT_SEL = '.lane-label, .title, .subtitle, .badge, .footnote, .legend-item, .node-label, .node-sub';

// 复现用户反馈：高泳道（3 节点）的标题「转发层 / Cluster」与
// 同泳道垂直边标签「PublishForward」曾经重叠 848px²。
const TALL_LANE = {
  title: '高泳道文字避让',
  layout: 'lanes',
  groups: [
    { id: 'client', label: '客户端', tone: 'blue' },
    { id: 'access', label: '接入层 / L4', tone: 'cyan' },
    { id: 'forward', label: '转发层 / Cluster', tone: 'violet' },
    { id: 'state', label: '状态与订阅', tone: 'green' },
  ],
  nodes: [
    { id: 'c1', label: 'MQTT Client', kind: 'client', group: 'client' },
    { id: 'lb', label: 'L4 Service', kind: 'network', group: 'access' },
    { id: 'n1', label: 'Broker N1', sub: 'PublishForward', kind: 'service', group: 'forward' },
    { id: 'n2', label: 'Broker N2', sub: '$share 选点', kind: 'service', group: 'forward' },
    { id: 'n3', label: 'Broker N3', sub: 'NodeLoadTable', kind: 'service', group: 'forward' },
    { id: 'subs', label: '订阅表 / 会话', kind: 'db', group: 'state' },
  ],
  edges: [
    { from: 'c1', to: 'lb', label: 'CONNECT', primary: true },
    { from: 'lb', to: 'n1' },
    { from: 'n1', to: 'n2', label: 'PublishForward' },
    { from: 'n1', to: 'n3', label: 'shared_groups' },
    { from: 'n2', to: 'subs', label: '负载快照' },
    { from: 'n3', to: 'subs', label: '恰好一次' },
  ],
};

// ─── 纯函数 ────────────────────────────────────────────────────

test('normalizeSpec 填充默认值并保留结构', () => {
  const s = normalizeSpec(SAMPLE);
  assert.equal(s.theme, 'dark');
  assert.equal(s.layout, 'lanes');
  assert.equal(s.nodes.length, 2);
  assert.equal(s.edges[0].primary, true);
  assert.equal(s.groups[0].tone, 'cyan');
  assert.equal(s.nodes[1].sub, 'gateway');
});

test('normalizeSpec 支持 JSON 字符串', () => {
  const s = normalizeSpec(JSON.stringify({ layout: 'row', nodes: [{ id: 'x', label: 'X' }] }));
  assert.equal(s.layout, 'row');
  assert.equal(s.nodes[0].kind, 'default');
  assert.equal(s.edges.length, 0);
});

test('normalizeSpec 拒绝非法 spec', () => {
  assert.throws(() => normalizeSpec('{oops'), /不是合法 JSON/);
  assert.throws(() => normalizeSpec({}), /nodes 必须是非空数组/);
  assert.throws(() => normalizeSpec({ nodes: [{ id: 'a' }, { id: 'a' }] }), /id 重复/);
  assert.throws(() => normalizeSpec({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'ghost' }] }), /不存在的节点/);
});

test('buildDiagramHTML 含节点、分组、图例、标准箭头与校验引擎', () => {
  const html = buildDiagramHTML(SAMPLE, { width: 1200, height: 675 });
  assert.match(html, /data-node="a"/);
  assert.match(html, /data-node="b"/);
  assert.match(html, /接入层/);
  assert.match(html, /class="legend-item"/);
  assert.match(html, /"primary":true/);
  assert.match(html, /id="edges"/);
  assert.match(html, /__DIAGRAM_AUDIT__/);
  assert.match(html, /markerUnits="userSpaceOnUse"/);
  assert.match(html, /orient="auto"/);
  assert.match(html, /arrowTextAudit/);
});

test('light 主题切换生效', () => {
  assert.ok(buildDiagramHTML(SAMPLE).includes('#0b0e14'));
  assert.ok(buildDiagramHTML({ ...SAMPLE, theme: 'light' }).includes('#f7f9fc'));
});

test('未知 kind 回退到 default', () => {
  assert.equal(normalizeSpec({ nodes: [{ id: 'x', kind: 'nope' }] }).nodes[0].kind, 'default');
  assert.ok(KIND.default);
});

// ─── 渲染校验 ──────────────────────────────────────────────────

test('端到端：标准箭头 + 全部校验通过 + 2x 输出', async (t) => {
  const chromium = requirePlaywright(t);
  if (!chromium) return;
  const { generateDiagram } = require('../src/lib/generator');
  const out = path.join(os.tmpdir(), `cp-diagram-${process.pid}.png`);
  try {
    const result = await generateDiagram({ spec: SAMPLE, out });
    const buf = fs.readFileSync(out);
    assert.equal(buf.slice(1, 4).toString(), 'PNG');
    assert.equal(buf.readUInt32BE(16), 2400, '2x 宽');
    assert.equal(buf.readUInt32BE(20), 1350, '2x 高');
    assert.equal(result.audit.passed, true);
    for (const [k, v] of Object.entries(result.audit.checks)) {
      assert.equal(v.ok, true, `${k}: ${v.detail}`);
    }
  } finally {
    fs.rmSync(out, { force: true });
  }
});

test('校验：箭头使用固定像素标准三角，不与文字重叠', async (t) => {
  const chromium = requirePlaywright(t);
  if (!chromium) return;
  const r = await auditInBrowser(chromium, STRESS);
  assert.deepEqual(r.errors, []);
  assert.ok(r.audit, '应产出 __DIAGRAM_AUDIT__');
  assert.ok(r.markers.length >= 2);
  for (const m of r.markers) {
    assert.equal(m.units, 'userSpaceOnUse');
    assert.equal(m.orient, 'auto');
    assert.equal(m.refX, '12');
    assert.equal(m.w, '12');
  }
  assert.equal(r.audit.checks.arrowClearance.ok, true, r.audit.checks.arrowClearance.detail);
  const d = parseFloat(r.audit.checks.arrowClearance.detail.match(/min distance=([\d.]+)px/)[1]);
  assert.ok(d >= 12, `箭头与文字最小距离 ${d}px 应 >= 12px`);
});

test('校验：连线标签不重叠、不压节点、与箭头保持距离', async (t) => {
  const chromium = requirePlaywright(t);
  if (!chromium) return;
  const r = await auditInBrowser(chromium, STRESS);
  assert.equal(r.audit.passed, true, JSON.stringify(r.audit.checks));
  const expected = STRESS.edges.filter(e => e.label).length;
  assert.equal(r.labelBoxes.length, expected, '所有标签都必须保留，不能被丢弃');
  for (let i = 0; i < r.labelBoxes.length; i++) {
    for (let j = i + 1; j < r.labelBoxes.length; j++) {
      assert.equal(inter(r.labelBoxes[i], r.labelBoxes[j]), 0, '标签之间不能重叠');
    }
    for (const n of r.nodes) {
      assert.equal(inter(r.labelBoxes[i], n), 0, '标签不能压住节点');
    }
  }
  assert.equal(r.audit.checks.labelArrowClearance.ok, true, r.audit.checks.labelArrowClearance.detail);
  const d = parseFloat(r.audit.checks.labelArrowClearance.detail.match(/min distance=([\d.]+)px/)[1]);
  assert.ok(d >= 12, `标签与箭头最小距离 ${d}px 应 >= 12px`);
});

test('校验：自动修复拥挤布局（多轮收紧字号/间距/缩放）', async (t) => {
  const chromium = requirePlaywright(t);
  if (!chromium) return;
  const r = await auditInBrowser(chromium, STRESS);
  assert.equal(r.audit.passed, true);
  for (const k of ['canvasOverflow', 'nodeOverlap', 'textClipped', 'edgeLength', 'canvasRatio',
                   'labelOverlap', 'labelNodeClearance', 'labelTextClearance',
                   'labelArrowClearance', 'arrowClearance', 'arrowRendered']) {
    assert.equal(r.audit.checks[k].ok, true, `${k}: ${r.audit.checks[k].detail}`);
  }
  assert.equal(r.paths.length, STRESS.edges.length);
  assert.ok(r.paths.every(d => d && !/NaN|undefined/.test(d)));
});

test('校验：连线标签不得压在泳道标题等任意文字上（高泳道回归）', async (t) => {
  const chromium = requirePlaywright(t);
  if (!chromium) return;
  const r = await auditInBrowser(chromium, TALL_LANE);
  assert.deepEqual(r.errors, []);
  assert.equal(r.audit.passed, true, JSON.stringify(r.audit.checks));
  assert.equal(r.audit.checks.labelTextClearance.ok, true, r.audit.checks.labelTextClearance.detail);
  const expected = TALL_LANE.edges.filter(e => e.label).length;
  assert.equal(r.labelTexts.length, expected, '所有标签都必须保留');
  for (const l of r.labelTexts) {
    for (const tx of r.texts) {
      assert.equal(inter(l, tx), 0,
        `连线标签与页面文字发生重叠: label@${Math.round(l.left)},${Math.round(l.top)} text@${Math.round(tx.left)},${Math.round(tx.top)}`);
    }
  }
  const d = parseFloat(r.audit.checks.labelTextClearance.detail.match(/min distance=([\d.]+)px/)[1]);
  assert.ok(d >= 8, `标签与文字最小距离 ${d}px 应 >= 8px`);
});

// 复现用户反馈：「一条消息在转发层的决策路径」里 primary 边箭头缺失。
// 根因是 path 挂 filter 时水平路径 bbox 高=0，滤镜区域塌陷把 marker 一起裁掉。
const FLOW_WITH_PRIMARY = {
  title: '一条消息在转发层的决策路径',
  theme: 'light', layout: 'row',
  nodes: [
    { id: 'p', label: 'Publisher', kind: 'client' },
    { id: 'm', label: 'Match', sub: 'TopicFilter', kind: 'service' },
    { id: 's', label: 'Selector', sub: 'NodeLoadTable', kind: 'service' },
    { id: 'f', label: 'Forward', sub: 'PublishForward', kind: 'network' },
    { id: 'd', label: 'Delivery', sub: '$share 恰好一次', kind: 'db' },
  ],
  edges: [
    { from: 'p', to: 'm', primary: true },
    { from: 'm', to: 's', label: '候选节点' },
    { from: 's', to: 'f', label: '选点结果', primary: true },
    { from: 'f', to: 'd', label: 'SharedGroups' },
  ],
};

test('校验：每条边的箭头都真实渲染（primary 边不因 filter 缺失）', async (t) => {
  const chromium = requirePlaywright(t);
  if (!chromium) return;
  let sharp;
  try { sharp = require('sharp'); } catch { t.skip('sharp 不可用，跳过像素级校验'); return; }

  const H = 360, W = 1200, DPR = 2;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent(buildDiagramHTML(FLOW_WITH_PRIMARY, { width: W, height: H }), { waitUntil: 'networkidle' });

  const info = await page.evaluate(() => {
    const sb = document.getElementById('stage').getBoundingClientRect();
    return {
      audit: window.__DIAGRAM_AUDIT__,
      paths: [...document.querySelectorAll('#edges path.edge-path')].map(p => {
        const L = p.getTotalLength(), e = p.getPointAtLength(L);
        return { filter: p.getAttribute('filter'), marker: p.getAttribute('marker-end'),
                 tip: { x: sb.left + e.x, y: sb.top + e.y } };
      }),
    };
  });
  assert.deepEqual(errors, []);
  assert.equal(info.audit.passed, true, JSON.stringify(info.audit.checks));
  assert.equal(info.audit.checks.arrowRendered.ok, true, info.audit.checks.arrowRendered.detail);
  assert.equal(info.paths.length, FLOW_WITH_PRIMARY.edges.length);
  // 结构前提：带 marker 的路径绝不能挂 filter
  info.paths.forEach((p, i) => {
    assert.ok(p.marker, `path[${i}] 缺少 marker-end`);
    assert.equal(p.filter, null, `path[${i}] 带 filter，箭头会被裁掉`);
  });

  const withArrows = Buffer.from(await page.screenshot({ type: 'png' }));
  await page.evaluate(() => document.querySelectorAll('#edges path.edge-path')
    .forEach(p => p.removeAttribute('marker-end')));
  const withoutArrows = Buffer.from(await page.screenshot({ type: 'png' }));

  const diff = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 4) {
      s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    }
    return s;
  };
  for (let i = 0; i < info.paths.length; i++) {
    const left = Math.round((info.paths[i].tip.x - 14) * DPR);
    const top = Math.round((info.paths[i].tip.y - 10) * DPR);
    const region = { left, top, width: 32, height: 40 };
    const a = await sharp(withArrows).extract(region).raw().toBuffer();
    const b = await sharp(withoutArrows).extract(region).raw().toBuffer();
    assert.ok(diff(a, b) > 1000,
      `path[${i}] 箭头未渲染（去掉 marker 后画面无变化，说明原本就缺箭头）`);
  }
  await browser.close();
});

test('校验：横线清晰可见、渐变生效、控制点不交叉（横线与箭头衔接回归）', async (t) => {
  const chromium = requirePlaywright(t);
  if (!chromium) return;
  let sharp;
  try { sharp = require('sharp'); } catch { t.skip('sharp 不可用，跳过像素级校验'); return; }

  const H = 360, W = 1200, DPR = 2;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent(buildDiagramHTML(FLOW_WITH_PRIMARY, { width: W, height: H }), { waitUntil: 'networkidle' });
  const audit = await page.evaluate(() => window.__DIAGRAM_AUDIT__);
  assert.deepEqual(errors, []);
  assert.equal(audit.passed, true, JSON.stringify(audit.checks));

  // 渐变必须脱离 objectBoundingBox，否则水平线 bbox 高=0 时整条不渲染
  const html = buildDiagramHTML(FLOW_WITH_PRIMARY, { width: W, height: H });
  assert.match(html, /linearGradient id="primary" gradientUnits="userSpaceOnUse"/);
  // 普通边不能用旧的淡色 / undefined
  assert.match(html, /edgeStrong|rgba\(61,68,77,0\.82\)/);
  assert.doesNotMatch(html, /'undefined'/);

  const paths = await page.evaluate(() => {
    const sb = document.getElementById('stage').getBoundingClientRect();
    return [...document.querySelectorAll('#edges path.edge-path')].map((p, i) => {
      const L = p.getTotalLength(), s = p.getPointAtLength(0), e = p.getPointAtLength(L);
      const m = p.getAttribute('d').match(/^M ([\d.]+) ([\d.]+) C ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+)/);
      const n = m ? m.slice(1).map(Number) : [];
      const x1 = Math.min(s.x, e.x), x2 = Math.max(s.x, e.x);
      const y1 = Math.min(s.y, e.y), y2 = Math.max(s.y, e.y);
      return {
        i, len: x2 - x1, cx1: n[2], cx2: n[4],
        width: parseFloat(p.getAttribute('stroke-width')),
        region: {
          left: Math.max(0, Math.round((sb.left + x1 - 4) * 2)),
          top: Math.max(0, Math.round((sb.top + y1 - 8) * 2)),
          width: Math.round(Math.max(24, (x2 - x1 + 8) * 2)),
          height: Math.round(Math.max(24, (y2 - y1 + 16) * 2)),
        },
      };
    });
  });
  assert.equal(paths.length, FLOW_WITH_PRIMARY.edges.length);
  // 结构前提：线要足够长、足够粗、控制点顺序正确（不能打结回环）
  for (const p of paths) {
    assert.ok(p.len >= 18, `path[${p.i}] 线长仅 ${p.len.toFixed(1)}px，箭头会占满整条线`);
    assert.ok(p.width >= 2, `path[${p.i}] 线宽 ${p.width} 太细`);
    assert.ok(p.cx1 <= p.cx2, `path[${p.i}] 控制点交叉，曲线会回环（${p.cx1} > ${p.cx2}）`);
  }

  // 像素验证：隐藏标签后，去掉 stroke 前后每条线区域都必须有明显变化
  await page.evaluate(() => document.querySelectorAll('#edges g.edge-label').forEach(x => { x.style.display = 'none'; }));
  const withStroke = Buffer.from(await page.screenshot({ type: 'png' }));
  await page.evaluate(() => document.querySelectorAll('#edges path.edge-path, #edges path:not(.edge-path)')
    .forEach(x => x.setAttribute('stroke', 'none')));
  const noStroke = Buffer.from(await page.screenshot({ type: 'png' }));
  const diff = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 4) {
      s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    }
    return s;
  };
  for (const p of paths) {
    const a = await sharp(withStroke).extract(p.region).raw().toBuffer();
    const b = await sharp(noStroke).extract(p.region).raw().toBuffer();
    assert.ok(diff(a, b) > 1000,
      `path[${p.i}] 横线不可见（primary 渐变可能又退化成 objectBoundingBox）`);
  }
  await browser.close();
});

test('校验：generateDiagram 在校验不通过时拒绝产出坏图', async (t) => {
  const chromium = requirePlaywright(t);
  if (!chromium) return;
  const { generateDiagram } = require('../src/lib/generator');
  const out = path.join(os.tmpdir(), `cp-diagram-bad-${process.pid}.png`);
  try {
    await assert.rejects(
      () => generateDiagram({ spec: STRESS, out, width: 260, height: 180, autoFit: false }),
      /图表校验未通过/,
    );
  } finally {
    fs.rmSync(out, { force: true });
  }
});
