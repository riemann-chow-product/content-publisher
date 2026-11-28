/**
 * markdown-wechat-list.test.js — 微信渲染的有序列表与冒号回归
 *
 * 微信编辑器会剥离 <ol> 的语义导致每个 <li> 都从 1 开始编号；
 * 并会把紧跟 <strong> 的中文冒号挤到下一行。
 * 通过「有序列表转 section 卡片 + 显式编号」和「冒号并入粗体」修复。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const MarkdownParser = require('../src/lib/markdown');

test('有序列表渲染为显式编号的 section，避免微信全部显示为 1', () => {
  const md = `1. **服务与流量层** 统一入口、鉴权\n2. **编排与推理层** Planner、Agent Loop\n3. **上下文与记忆层** Prompt 组装\n`;
  const html = MarkdownParser.renderForPlatform(md, 'wechat');

  // 不再依赖微信对 <ol> 的自动编号
  assert.doesNotMatch(html, /<ol[\s>]/, '不应输出 <ol> 标签');
  // 三项的显式编号都要出现
  for (const n of ['1', '2', '3']) {
    assert.ok(html.includes(`>${n}<`), `缺少显式编号 ${n}`);
  }
  // 列表项内容都保留
  assert.ok(html.includes('服务与流量层'));
  assert.ok(html.includes('编排与推理层'));
  assert.ok(html.includes('上下文与记忆层'));
});

test('紧跟粗体的中文冒号并入粗体，避免微信把冒号挤到下一行', () => {
  const md = `- **COST（GPU 时）**：算力从弹性资源变成刚性预算项\n- **INTERFACE（Tokens）**：接口从强类型结构变成自然语言语义\n`;
  const html = MarkdownParser.renderForPlatform(md, 'wechat');

  assert.ok(html.includes('<strong>COST（GPU 时）：</strong>'), '冒号应并入粗体内');
  assert.ok(html.includes('<strong>INTERFACE（Tokens）：</strong>'));
  // 不应出现「</strong>：」这种冒号裸露在粗体之后的结构
  assert.doesNotMatch(html, /<\/strong>：/, '冒号不能裸露在 </strong> 之后');
});

test('不跟在粗体后的冒号不受影响', () => {
  const md = `普通段落：这里有一个冒号。\n\n- 普通列表项：后面有冒号。\n`;
  const html = MarkdownParser.renderForPlatform(md, 'wechat');
  assert.ok(html.includes('普通段落：这里有一个冒号。'));
  assert.ok(html.includes('普通列表项：后面有冒号。'));
});

test('无序列表保持 <ul> 不变', () => {
  const md = `- 第一项\n- 第二项\n`;
  const html = MarkdownParser.renderForPlatform(md, 'wechat');
  assert.match(html, /<ul[\s>]/, '无序列表仍使用 <ul>');
  assert.equal((html.match(/<li[\s>]/g) || []).length, 2);
});
