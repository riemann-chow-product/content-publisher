/**
 * markdown-table.test.js — 表格解析的空行回归
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const MarkdownParser = require('../src/lib/markdown');

test('表格末尾的孤立竖线不再生成空白行', () => {
  for (const last of ['|', '| ', '||']) {
    const md = `| A | B |\n| --- | --- |\n| a | b |\n${last}\n`;
    const html = MarkdownParser.parse(md).html;
    assert.doesNotMatch(html, /<tr><\/tr>/, `末尾 ${JSON.stringify(last)} 仍生成空行`);
    assert.equal((html.match(/<tr>/g) || []).length, 2, '表头 + 一行数据');
  }
});

test('正常多行表格不受影响', () => {
  const md = `| A | B |\n| --- | --- |\n| a | b |\n| c | d |\n`;
  const html = MarkdownParser.parse(md).html;
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.ok(html.includes('<td>c</td><td>d</td>'));
});
