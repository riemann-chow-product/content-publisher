#!/usr/bin/env node
/**
 * generate 子命令 — 使用 frontend-design 美学 + Playwright 截图
 * 生成文章配图 / 封面图
 *
 * 用法:
 *   content-publisher generate cover <title> --out cover.png
 *   content-publisher generate illustration <description> --out img.png [--width 1200] [--height 630]
 *   content-publisher generate article-images <file.md> --out-dir ./imgs
 *   content-publisher generate diagram <spec.json|JSON|-> --out fig.png
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

// ── diagram (Archify 风格静态图) ────────────────────────────────
cmd
  .command('diagram <spec>')
  .description('按结构化 JSON spec 生成 Archify 风格静态图表（1200×675, 2x 输出）')
  .option('-o, --out <path>', '输出文件路径', 'diagram.png')
  .option('--style <name>', '主题: dark|light', 'dark')
  .option('--width <n>', '宽度', '1200')
  .option('--height <n>', '高度', '675')
  .option('--scale <n>', '设备像素比（2 = 高清）', '2')
  .option('--no-auto-fit', '关闭画布高度自适应')
  .option('--audit-json', '打印完整校验报告（JSON）')
  .option('--stdin', '从标准输入读取 spec（也可把 <spec> 传成 -）')
  .action(async (specArg, opts) => {
    const { generateDiagram } = require('../lib/generator');
    let spec = specArg;
    if (specArg === '-' || opts.stdin) {
      spec = fs.readFileSync(0, 'utf-8');
    }
    const result = await generateDiagram({
      spec,
      out: opts.out,
      style: opts.style,
      width: parseInt(opts.width, 10),
      height: parseInt(opts.height, 10),
      scale: parseInt(opts.scale, 10),
      autoFit: opts.autoFit !== false,
    });
    if (opts.auditJson) {
      console.log(JSON.stringify(result.audit, null, 2));
    } else if (result.audit) {
      const a = result.audit;
      console.log(`  校验: ${a.passed ? '通过' : '未通过'} · ${Object.keys(a.checks).length} 项规则 · 自动修复 ${a.repairs.length} 次 · 画布 ${a.stageBox ? Math.round(a.stageBox.h) : '?'}px`);
    }
  });

// ── diagram-v2 (矢量优先 · 编辑级四类型图表) ──────────────────
cmd
  .command('diagram-v2 <spec>')
  .description('矢量优先生成四类技术图：架构图 / 流程图 / 时序图 / 网络部署图（2x 高清，一次成图无需二次润色）')
  .option('-o, --out <path>', '输出 PNG 路径', 'diagram.png')
  .option('--theme <name>', '主题: light|dark', 'light')
  .option('--scale <n>', '设备像素比（2 = 高清, 3 = 超清）', '2')
  .option('--svg-only', '只输出 SVG 矢量源文件')
  .option('--stdin', '从标准输入读取 spec（也可把 <spec> 传成 -）')
  .action(async (specArg, opts) => {
    const { renderV2 } = require('../lib/generator');
    let spec = specArg;
    if (specArg === '-' || opts.stdin) spec = fs.readFileSync(0, 'utf-8');
    await renderV2({
      spec,
      out: opts.out,
      theme: opts.theme,
      scale: parseInt(opts.scale, 10),
      svgOnly: opts.svgOnly,
    });
  });

// ── article-images ──────────────────────────────────────────────
cmd
  .command('article-images <file>')
  .description('扫描 Markdown 文件中的图片占位符，自动生成配图')
  .option('--out-dir <dir>', '输出目录', '.')
  .option('--style <name>', '风格', 'dark')
  .option('--keep-block', '保留文章里的 diagram 代码块（不替换成图片引用）', false)
  .action(async (file, opts) => {
    const { generateArticleImages } = require('../lib/generator');
    await generateArticleImages({
      file,
      outDir: opts.outDir,
      style: opts.style,
      keepBlock: opts.keepBlock,
    });
  });

module.exports = cmd;
