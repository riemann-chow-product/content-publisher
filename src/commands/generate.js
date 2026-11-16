#!/usr/bin/env node
/**
 * generate 子命令 — 使用 frontend-design 美学 + Playwright 截图
 * 生成文章配图 / 封面图
 *
 * 用法:
 *   content-publisher generate cover <title> --out cover.png
 *   content-publisher generate illustration <description> --out img.png [--width 1200] [--height 630]
 *   content-publisher generate article-images <file.md> --out-dir ./imgs
 */
'use strict';

const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

const cmd = new Command('generate')
  .description('使用 frontend-design 美学自动生成文章配图（HTML渲染+截图）');

// ── cover ────────────────────────────────────────────────────────
cmd
  .command('cover <title>')
  .description('生成文章封面图（900×500）')
  .option('-o, --out <path>', '输出文件路径', 'cover.png')
  .option('--subtitle <text>', '副标题')
  .option('--style <name>', '风格: dark|light|gradient|brutalist', 'dark')
  .option('--width <n>', '宽度', '900')
  .option('--height <n>', '高度', '500')
  .action(async (title, opts) => {
    const { generateCover } = require('../lib/generator');
    await generateCover({
      title,
      subtitle: opts.subtitle || '',
      style: opts.style,
      width: parseInt(opts.width, 10),
      height: parseInt(opts.height, 10),
      out: opts.out,
    });
  });

// ── illustration ────────────────────────────────────────────────
cmd
  .command('illustration <description>')
  .description('根据描述生成文章配图（HTML 渲染 + 截图）')
  .option('-o, --out <path>', '输出文件路径', 'illustration.png')
  .option('--width <n>', '宽度', '900')
  .option('--height <n>', '高度', '500')
  .option('--style <name>', '风格', 'dark')
  .action(async (description, opts) => {
    const { generateIllustration } = require('../lib/generator');
    await generateIllustration({
      description,
      style: opts.style,
      width: parseInt(opts.width, 10),
      height: parseInt(opts.height, 10),
      out: opts.out,
    });
  });

// ── article-images ──────────────────────────────────────────────
cmd
  .command('article-images <file>')
  .description('扫描 Markdown 文件中的图片占位符，自动生成配图')
  .option('--out-dir <dir>', '输出目录', '.')
  .option('--style <name>', '风格', 'dark')
  .action(async (file, opts) => {
    const { generateArticleImages } = require('../lib/generator');
    await generateArticleImages({
      file,
      outDir: opts.outDir,
      style: opts.style,
    });
  });

module.exports = cmd;
