/**
 * diagram-v2.test.js — 矢量渲染器的箭头方向与画幅自适应回归
 *
 * 纯函数测试，不依赖浏览器 / playwright。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSVG } = require('../src/lib/diagram-v2');

const flow = require('../examples/flow.json');
const sequence = require('../examples/sequence.json');

test('默认按信息密度选画幅，不再强制 4:3', () => {
  const r = buildSVG(flow);
  assert.equal(r.aspect, 'auto');
  assert.ok(r.ratio > 0);
  assert.notEqual(r.width / r.height, 4 / 3, '简单流程不应被塞进 4:3 画布');
  assert.ok(r.audit.arrowDirection.ok, r.audit.arrowDirection.detail);
});

test('显式 16:9 / 4:3 仍然生效', () => {
  const wide = buildSVG(flow, { aspect: '16:9' });
  assert.equal(wide.aspect, '16:9');
  assert.equal(wide.width / wide.height, 16 / 9);
  const info = buildSVG(flow, { aspect: '4:3' });
  assert.equal(info.aspect, '4:3');
  assert.equal(info.width / info.height, 4 / 3);
});

test('箭头只在终点：无 marker-start，每条边都有 marker-end', () => {
  const r = buildSVG(flow);
  assert.doesNotMatch(r.svg, /marker-start\s*=/);
  const ends = (r.svg.match(/marker-end="/g) || []).length;
  assert.equal(ends, flow.edges.length);
  assert.equal(r.audit.arrowDirection.ok, true, r.audit.arrowDirection.detail);

  const seq = buildSVG(sequence);
  assert.doesNotMatch(seq.svg, /marker-start\s*=/);
  assert.equal((seq.svg.match(/marker-end="/g) || []).length, sequence.messages.length);
  assert.equal(seq.audit.arrowDirection.ok, true, seq.audit.arrowDirection.detail);
});

test('时序图反向消息的箭头落在目标节点一侧，而不是起点一侧', () => {
  const r = buildSVG(sequence);
  // 反向消息：from=db（右侧） to=b（左侧），箭头应在 b 的右边缘之外。
  const reverse = sequence.messages.findIndex(m => m.from === 'db' && m.to === 'b');
  assert.ok(reverse >= 0);
  const paths = [...r.svg.matchAll(/<path d="(M[\d.]+ [\d.]+ H[\d.]+)"[^>]*marker-end="/g)];
  // 生命线之外只有消息路径是水平 M…H…，按序号取第 reverse 条。
  const d = paths[reverse] && paths[reverse][1];
  assert.ok(d, `第 ${reverse + 1} 条消息路径缺失`);
  const endX = Number(d.match(/H([\d.]+)$/)[1]);
  // Broker 是第 3 个参与者；反向消息箭头应落在其右边缘之外。
  const boxes = [...r.svg.matchAll(/<rect x="(\d+)" y="\d+" width="168" height="58"/g)];
  const broker = boxes[2];
  assert.ok(broker, 'Broker 参与节点缺失');
  const rightEdge = Number(broker[1]) + 168;
  assert.ok(endX >= rightEdge, `反向消息箭头落在起点一侧: endX=${endX}, brokerRight=${rightEdge}`);
});

test('tight 画幅贴合内容，仍保留全部箭头', () => {
  const r = buildSVG(flow, { aspect: 'tight' });
  assert.equal(r.aspect, 'tight');
  assert.doesNotMatch(r.svg, /marker-start\s*=/);
  assert.equal((r.svg.match(/marker-end="/g) || []).length, flow.edges.length);
});
