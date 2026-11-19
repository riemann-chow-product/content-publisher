/**
 * size.test.js — 文章配图尺寸规范
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAspect, aspectFor, resolveSize, fitCanvas, PRESETS,
} = require('../src/lib/size');

test('normalizeAspect 识别别名与比例', () => {
  assert.equal(normalizeAspect('16:9'), '16:9');
  assert.equal(normalizeAspect('wide'), '16:9');
  assert.equal(normalizeAspect('4:3'), '4:3');
  assert.equal(normalizeAspect('info'), '4:3');
  assert.equal(normalizeAspect('auto'), null);
  assert.equal(normalizeAspect('weird'), null);
});

test('默认比例：封面 16:9，信息图 4:3', () => {
  assert.equal(aspectFor('cover'), '16:9');
  assert.equal(aspectFor('illustration'), '4:3');
  assert.equal(aspectFor('architecture'), '4:3');
  assert.equal(aspectFor('flow'), '16:9');
  assert.equal(aspectFor('sequence'), '4:3');
  assert.equal(aspectFor('deployment'), '4:3');
  assert.equal(aspectFor('code'), null);
});

test('resolveSize 按类型取预设，显式尺寸优先', () => {
  assert.deepEqual(
    { w: resolveSize({ kind: 'cover' }).width, h: resolveSize({ kind: 'cover' }).height },
    { w: PRESETS['16:9'].width, h: PRESETS['16:9'].height }
  );
  const d = resolveSize({ kind: 'diagram' });
  assert.equal(d.aspect, '4:3');
  assert.equal(d.width / d.height, 4 / 3);
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
