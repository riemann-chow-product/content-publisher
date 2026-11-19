/**
 * size.js — 文章配图尺寸规范（横图优先）
 *
 * 两种标准横图比例：
 *   16:9 (wide) —— 宽幅场景、产品展示、氛围图、封面图
 *    4:3 (info) —— 信息图、数据对比、架构/流程/时序/部署图等需要看清细节的内容
 *
 * 所有尺寸以「逻辑像素」为准；实际 PNG 分辨率 = 逻辑尺寸 × deviceScaleFactor。
 */
'use strict';

const PRESETS = {
  '16:9': { width: 1200, height: 675, alias: 'wide' },
  '4:3':  { width: 1200, height: 900, alias: 'info' },
};

// 不同出图路径的默认比例
const DEFAULT_ASPECT = {
  cover: '16:9',
  illustration: '4:3', // 概念图 / 流程示意属于信息图
  diagram: '4:3',
  architecture: '4:3', // 信息图，需要看清分层与标注
  flow: '16:9',        // 通常为单行宽幅流程，按宽幅场景处理
  sequence: '4:3',     // 纵向生命线 + 消息，细节多
  deployment: '4:3',   // 区域 / 协议标注，细节多
  code: null, // 代码截图按内容高度，不套比例
};

function normalizeAspect(value) {
  if (value == null || value === '' || value === 'auto') return null;
  const v = String(value).trim().toLowerCase();
  if (v === '16:9' || v === 'wide' || v === 'landscape' || v === '169') return '16:9';
  if (v === '4:3' || v === 'info' || v === '43') return '4:3';
  return null;
}

function aspectFor(kind) {
  return DEFAULT_ASPECT[kind] || null;
}

function preset(aspect) {
  const a = normalizeAspect(aspect) || '16:9';
  return { aspect: a, ...PRESETS[a] };
}

/**
 * 解析出图的逻辑尺寸。显式 width/height 优先；否则按 aspect 取预设。
 */
function resolveSize({ aspect, width, height, kind } = {}) {
  const a = normalizeAspect(aspect) || aspectFor(kind) || '16:9';
  const p = PRESETS[a];
  return {
    aspect: a,
    width: Number.isFinite(+width) && +width > 0 ? Math.round(+width) : p.width,
    height: Number.isFinite(+height) && +height > 0 ? Math.round(+height) : p.height,
  };
}

/**
 * 把内容画布装进指定比例的横图画布：只放大画布、不缩小内容（保证文字锐利）。
 * 返回 dx/dy 供调用方把内容居中摆放。
 */
function fitCanvas(contentW, contentH, aspect) {
  const a = normalizeAspect(aspect) || '4:3';
  const ratio = a === '16:9' ? 16 / 9 : 4 / 3;
  const unit = a === '16:9' ? 16 : 4; // 保证宽高都是整数且比例精确
  const width = Math.ceil(Math.max(contentW, contentH * ratio) / unit) * unit;
  const height = Math.round(width / ratio);
  return {
    aspect: a,
    width,
    height,
    dx: Math.round((width - contentW) / 2),
    dy: Math.round((height - contentH) / 2),
  };
}

module.exports = {
  PRESETS, DEFAULT_ASPECT,
  normalizeAspect, aspectFor, preset, resolveSize, fitCanvas,
};
