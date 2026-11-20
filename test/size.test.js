/**
 * size.test.js — 文章配图尺寸规范
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAspect, aspectFor, resolveSize, fitCanvas, fitDenseCanvas, PRESETS,
} = require('../src/lib/size');

test('normalizeAspect 识别别名与比例', () => {
  assert.equal(normalizeAspect('16:9'), '16:9');
  assert.equal(normalizeAspect('wide'), '16:9');
  assert.equal(normalizeAspect('3:2'), '3:2');
  assert.equal(normalizeAspect('4:3'), '4:3');
  assert.equal(normalizeAspect('info'), '4:3');
  assert.equal(normalizeAspect('auto'), 'auto');
  assert.equal(normalizeAspect('density'), 'auto');
  assert.equal(normalizeAspect('tight'), 'tight');
  assert.equal(normalizeAspect('weird'), null);
});

test('默认比例：封面 16:9，其余按信息密度自适应', () => {
  assert.equal(aspectFor('cover'), '16:9');
  assert.equal(aspectFor('illustration'), 'auto');
  assert.equal(aspectFor('architecture'), 'auto');
  assert.equal(aspectFor('flow'), 'auto');
  assert.equal(aspectFor('sequence'), 'auto');
  assert.equal(aspectFor('deployment'), 'auto');
  assert.equal(aspectFor('code'), null);
});

test('resolveSize 按类型取预设，显式尺寸优先', () => {
  assert.deepEqual(
    { w: resolveSize({ kind: 'cover' }).width, h: resolveSize({ kind: 'cover' }).height },
    { w: PRESETS['16:9'].width, h: PRESETS['16:9'].height }
  );
  const d = resolveSize({ kind: 'diagram' });
  assert.equal(d.aspect, 'auto');
  const custom = resolveSize({ aspect: '16:9', width: 800, height: 600 });
  assert.equal(custom.width, 800);
  assert.equal(custom.height, 600);
});

test('fitCanvas 只放大画布不缩内容，且比例精确', () => {
  const r = fitCanvas(1754, 325, '4:3');
  assert.equal(r.width / r.height, 4 / 3);
  assert.ok(r.width >= 1754);
  assert.ok(r.height >= 325);
  assert.ok(r.dx >= 0 && r.dy >= 0);

  const w = fitCanvas(900, 900, '16:9');
  assert.equal(w.width / w.height, 16 / 9);
  assert.ok(w.width >= 900);
  assert.ok(w.height >= 900);

  const tall = fitCanvas(600, 1000, '4:3');
  assert.equal(tall.width / tall.height, 4 / 3);
  assert.ok(tall.width >= 600 && tall.height >= 1000);
});

test('fitDenseCanvas 按信息密度调整画幅，不再一律 4:3', () => {
  // 信息少：宽扁画布，右侧不留大片空白
  const sparse = fitDenseCanvas(700, 220);
  assert.ok(sparse.width / sparse.height > 2, `稀疏内容比例偏小: ${sparse.ratio}`);
  assert.ok(sparse.width >= 700 && sparse.height >= 220);
  assert.equal(sparse.aspect, 'auto');

  // 信息多：接近 4:3 的更高画布
  const dense = fitDenseCanvas(900, 720);
  assert.ok(dense.width / dense.height < 1.6, `密集内容比例偏大: ${dense.ratio}`);
  assert.ok(dense.height > sparse.height);

  // 超宽内容不被 maxWidth 裁掉
  const wide = fitDenseCanvas(2000, 260);
  assert.ok(wide.width >= 2000, `超宽内容被裁切: ${wide.width}`);

  // auto 画幅不强制 4:3
  const auto = fitCanvas(1000, 300, 'auto');
  assert.notEqual(auto.width / auto.height, 4 / 3);
});
