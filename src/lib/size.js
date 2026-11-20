/**
 * size.js — 文章配图尺寸规范（按信息密度自适应）
 *
 * 标准横图比例只作为「显式指定」或「与内容比例接近时」的候选，不再是强制画幅：
 *   16:9 (wide) —— 宽幅场景、产品展示、氛围图、封面图
 *    3:2  (balanced) —— 内容偏宽但不是纯流程的信息图
 *    4:3  (info) —— 信息密度高、需要看清细节的图
 *
 * 未显式指定比例时（auto/density），先量内容实际占比，再给一个紧凑画布；
 * 信息少 → 更扁，信息多 → 更高，避免右侧/下方出现大片空白。
 *
 * 所有尺寸以「逻辑像素」为准；实际 PNG 分辨率 = 逻辑尺寸 × deviceScaleFactor。
 */
'use strict';

const PRESETS = {
  '16:9': { width: 1200, height: 675, alias: 'wide' },
  '3:2':  { width: 1200, height: 800, alias: 'balanced' },
  '4:3':  { width: 1200, height: 900, alias: 'info' },
};

// 不同出图路径的「参考」比例：仅在无法测量内容时作为兜底。
// 内容可测量时（diagram-v2 / illustration）一律走 fitDenseCanvas。
const DEFAULT_ASPECT = {
  cover: '16:9',
  illustration: 'auto',
  diagram: 'auto',
  architecture: 'auto',
  flow: 'auto',
  sequence: 'auto',
  deployment: 'auto',
  code: null, // 代码截图按内容高度，不套比例
};

// 密度画布的边界与留白（逻辑像素）
const DENSITY = {
  padX: 112,        // 左右合计
  padY: 88,         // 上下合计
  minRatio: 1.0,    // 不允许竖图，但允许正方形
  maxRatio: 3.2,    // 超宽流程允许更扁，避免上下大片空白
  minWidth: 720,
  maxWidth: 1760,
  minHeight: 380,
  maxHeight: 1120,
  snap: 0.05,       // 比例按 0.05 取整，避免奇怪的小数
};

function normalizeAspect(value) {
  if (value == null || value === '') return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'auto' || v === 'density' || v === 'adaptive' || v === 'content') return 'auto';
  if (v === 'tight') return 'tight';
  if (v === '16:9' || v === 'wide' || v === 'landscape' || v === '169') return '16:9';
  if (v === '3:2' || v === 'balanced' || v === '32') return '3:2';
  if (v === '4:3' || v === 'info' || v === '43') return '4:3';
  return null;
}

function aspectFor(kind) {
  return DEFAULT_ASPECT[kind] || null;
}

function preset(aspect) {
  const a = normalizeAspect(aspect);
  if (a === 'auto' || a === 'tight' || !a) return null;
  return { aspect: a, ...PRESETS[a] };
}

function ratioOf(aspect) {
  const a = normalizeAspect(aspect);
  if (!a || a === 'auto' || a === 'tight') return null;
  const [w, h] = a.split(':').map(Number);
  return w && h ? w / h : null;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * 按内容实际尺寸算画幅：信息密度低 → 扁；信息密度高 → 高。
 * 返回一个紧凑的横图画布，内容居中，不缩放文字。
 */
function fitDenseCanvas(contentW, contentH, opts = {}) {
  const d = { ...DENSITY, ...opts };
  const cw = Math.max(1, Number(contentW) || 1);
  const ch = Math.max(1, Number(contentH) || 1);
  const wantW = cw + d.padX;
  const wantH = ch + d.padY;
  let ratio = clamp(wantW / wantH, d.minRatio, d.maxRatio);
  ratio = Math.round(ratio / d.snap) * d.snap;

  // 接近标准比例时直接采用预设，得到更整齐的像素尺寸。
  for (const [name, r] of [['16:9', 16 / 9], ['3:2', 3 / 2], ['4:3', 4 / 3]]) {
    if (Math.abs(ratio - r) <= 0.035) {
      ratio = r;
      break;
    }
  }

  // 先保证内容放得下：高度同时满足「内容高 + 留白」与「内容宽 / 最大比例」。
  let height = Math.ceil(Math.max(wantH, wantW / ratio) / 8) * 8;
  height = clamp(height, d.minHeight, d.maxHeight);
  let width = Math.max(Math.ceil(cw / 8) * 8, Math.round(height * ratio / 8) * 8);
  if (width > d.maxWidth && wantW <= d.maxWidth) {
    width = d.maxWidth;
    height = Math.min(d.maxHeight, Math.ceil(width / ratio / 8) * 8);
  }
  // 极端宽的内容不允许被裁掉：宁可突破 maxWidth，也不留右侧空白。
  width = Math.max(width, Math.ceil(wantW / 8) * 8);
  height = clamp(height, d.minHeight, d.maxHeight);
  return {
    aspect: 'auto',
    ratio: Number(ratio.toFixed(4)),
    width, height,
    dx: Math.round((width - cw) / 2),
    dy: Math.round((height - ch) / 2),
  };
}

/**
 * 解析出图的逻辑尺寸。显式 width/height 优先；否则按 aspect 取预设。
 * aspect 为 auto/density 时按内容尺寸自适应（需传 contentWidth/contentHeight）。
 */
function resolveSize({ aspect, width, height, kind, contentWidth, contentHeight } = {}) {
  const a = normalizeAspect(aspect) || aspectFor(kind) || '16:9';
  if ((a === 'auto' || a === 'tight') && contentWidth && contentHeight) {
    const fit = a === 'tight'
      ? { width: Math.ceil(contentWidth), height: Math.ceil(contentHeight), aspect: 'tight', ratio: contentWidth / contentHeight }
      : fitDenseCanvas(contentWidth, contentHeight);
    return {
      aspect: fit.aspect,
      ratio: fit.ratio,
      width: Number.isFinite(+width) && +width > 0 ? Math.round(+width) : fit.width,
      height: Number.isFinite(+height) && +height > 0 ? Math.round(+height) : fit.height,
    };
  }
  const p = (a === 'auto' || a === 'tight')
    ? PRESETS['3:2'] // 没有可测量内容时的折中兜底，避免回到强制 4:3
    : (PRESETS[a] || PRESETS['16:9']);
  return {
    aspect: a,
    ratio: ratioOf(a),
    width: Number.isFinite(+width) && +width > 0 ? Math.round(+width) : p.width,
    height: Number.isFinite(+height) && +height > 0 ? Math.round(+height) : p.height,
  };
}

/**
 * 把内容画布装进指定比例的横图画布：只放大画布、不缩小内容（保证文字锐利）。
 * aspect 为 auto/density 时改为按信息密度自适应，不再强制 4:3。
 * 返回 dx/dy 供调用方把内容居中摆放。
 */
function fitCanvas(contentW, contentH, aspect) {
  const a = normalizeAspect(aspect);
  if (!a || a === 'auto' || a === 'tight') {
    return fitDenseCanvas(contentW, contentH);
  }
  const ratio = ratioOf(a) || 4 / 3;
  const unit = a === '16:9' ? 16 : 4; // 保证宽高都是整数且比例精确
  const width = Math.ceil(Math.max(contentW, contentH * ratio) / unit) * unit;
  const height = Math.round(width / ratio);
  return {
    aspect: a,
    ratio,
    width,
    height,
    dx: Math.round((width - contentW) / 2),
    dy: Math.round((height - contentH) / 2),
  };
}

module.exports = {
  PRESETS, DEFAULT_ASPECT, DENSITY,
  normalizeAspect, aspectFor, preset, ratioOf, resolveSize, fitCanvas, fitDenseCanvas,
};
