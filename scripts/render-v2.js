/**
 * render-v2.js — 把 diagram-v2 的 SVG 渲染为高清 PNG
 * 用法：node scripts/render-v2.js <spec.json> <out.png> [scale]
 */
'use strict';
const fs = require('fs');
const path = require('path');

async function render(specPath, outPath, scale = 2) {
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  const { buildSVG } = require('../src/lib/diagram-v2');
  const { svg, width, height, audit } = buildSVG(spec);

  // 同时导出 SVG（矢量源文件，便于二次编辑）
  const svgPath = outPath.replace(/\.png$/i, '.svg');
  fs.writeFileSync(svgPath, svg, 'utf-8');

  const { chromium } = require('playwright');
  const fs2 = require('fs');
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launchOpts = { headless: true };
  // 优先用系统 Chrome（字体与 CJK 渲染稳定），缺失时回退 Playwright 自带内核
  if (fs2.existsSync(systemChrome)) launchOpts.executablePath = systemChrome;
  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    delete launchOpts.executablePath;
    browser = await chromium.launch(launchOpts);
  }
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  await page.setContent(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${width}px;height:${height}px;overflow:hidden}</style></head><body>${svg}</body></html>`,
    { waitUntil: 'networkidle' }
  );
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();
  console.log(`${path.basename(outPath)}  ${width}x${height} @${scale}x  audit=${audit.passed ? 'PASS' : 'FAIL'}`);
  if (!audit.passed) console.log(JSON.stringify(audit));
  return { outPath, svgPath, width, height, audit };
}

if (require.main === module) {
  const [specPath, outPath, scale] = process.argv.slice(2);
  if (!specPath || !outPath) {
    console.error('usage: node scripts/render-v2.js <spec.json> <out.png> [scale]');
    process.exit(1);
  }
  render(specPath, outPath, scale ? parseInt(scale, 10) : 2).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
module.exports = { render };
