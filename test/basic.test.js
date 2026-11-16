/**
 * 基础功能测试
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// 测试 Markdown 解析
const MarkdownParser = require('../src/lib/markdown');

describe('Markdown 解析', () => {
  test('提取 front-matter 元数据', () => {
    const content = `---
title: 测试文章
author: 张三
tags:
  - 科技
  - AI
---

# 正文开始

这是一段正文。`;

    const result = MarkdownParser.parse(content);
    assert.strictEqual(result.meta.title, '测试文章');
    assert.strictEqual(result.meta.author, '张三');
    assert.deepStrictEqual(result.meta.tags, ['科技', 'AI']);
    assert.ok(result.html.includes('<h1>正文开始</h1>'));
  });

  test('无 front-matter 时正常解析', () => {
    const content = `# 标题

正文内容`;

    const result = MarkdownParser.parse(content);
    assert.strictEqual(result.meta.title, undefined);
    assert.ok(result.html.includes('<h1>标题</h1>'));
  });

  test('提取图片列表', () => {
    const content = `![
图片1](img1.jpg)

![图片2](img2.png)

文字`;

    const images = MarkdownParser.extractImages(content);
    assert.strictEqual(images.length, 2);
    assert.strictEqual(images[0].src, 'img1.jpg');
    assert.strictEqual(images[1].src, 'img2.png');
  });
});

// 测试 Logger
const Logger = require('../src/lib/logger');

describe('Logger', () => {
  test('table 渲染正常', () => {
    const logger = new Logger();
    // 不抛异常即通过
    logger.table(['ID', '名称'], [['1', '测试']]);
  });
});

// 测试 Config
const Config = require('../src/lib/config');

describe('Config', () => {
  test('set/get 正常', () => {
    const config = new Config({ profile: 'test-profile' });
    config.set('test.key', 'hello');
    assert.strictEqual(config.get('test.key'), 'hello');
  });
});
