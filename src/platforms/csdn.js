/**
 * CSDN 平台适配器
 *
 * 说明：CSDN 旧的基于 Cookie 的 v1 发布接口（blog-dev.csdn.net）已废弃/公网不可达，
 * 现采用 Playwright 驱动官方 Markdown 编辑器（editor.csdn.net/md/）完成发布：
 *   1. 注入 CSDN Cookie 登录
 *   2. 通过编辑器图片输入框直传图片到 CSDN OBS，拿到 CDN URL
 *   3. 用 CDN URL 替换正文里的本地图片路径
 *   4. 导入正文 + 填写标题 + 点“保存草稿”
 */
'use strict';

const BasePlatform = require('./base');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function parseFrontMatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: md.slice(m[0].length) };
}

class CsdnPlatform extends BasePlatform {
  get name() { return 'CSDN'; }
  get id() { return 'csdn'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://mp.csdn.net/v1';
  }

  /** 验证凭证：仅检查 Cookie 是否已配置（浏览器发布在后台确认） */
  async verify() {
    const cookie = this.config.get('csdn.cookie');
    if (!cookie) return { valid: false, message: '未配置 CSDN Cookie' };
    return { valid: true, message: 'Cookie 已配置（浏览器发布，请在后台确认）' };
  }

  async uploadImage() {
    throw new Error('CSDN 图片走编辑器直传，不使用 uploadImage');
  }

  /**
   * 单图上传（每张图开一个新页面，绕开编辑器单页 3 次上传限制）
   * 监听 context 级别的 OBS 回调响应来拿 CDN URL
   */
  async _uploadOne(ctx, state, filePath, sleep) {
    const fileName = path.basename(filePath);
    for (let attempt = 1; attempt <= 3; attempt++) {
      state.pending = { file: fileName, url: null };
      const p = await ctx.newPage();
      await p.goto('https://editor.csdn.net/md/', { waitUntil: 'load', timeout: 30000 });
      await p.waitForTimeout(3500);
      const input = p.locator('.cfw-file-input').first();
      if (await input.count() === 0) {
        this.logger.warn(`第${attempt}次未找到文件输入框(${fileName})`);
        await p.close(); await sleep(800); continue;
      }
      try {
        await input.setInputFiles(filePath);
      } catch (e) {
        this.logger.warn(`第${attempt}次 setInputFiles 失败(${fileName}): ${e.message.split('\n')[0]}`);
        await p.close(); await sleep(800); continue;
      }
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (state.pending && state.pending.url) { await p.close(); return state.pending.url; }
        await sleep(250);
      }
      this.logger.warn(`第${attempt}次上传超时(${fileName})，重试`);
      await p.close();
    }
    throw new Error('图片上传失败(多次重试): ' + fileName);
  }

  /**
   * 发布文章到 CSDN（浏览器驱动，保存为草稿）
   */
  async publish(article) {
    const { sourceFile, baseDir, draft = true } = article;
    if (!sourceFile || !fs.existsSync(sourceFile)) {
      throw new Error('CSDN 发布需要源 Markdown 文件路径（sourceFile）');
    }
    const cookie = this.config.get('csdn.cookie');
    if (!cookie) throw new Error('CSDN Cookie 未配置，请运行: content-publisher config set csdn.cookie <COOKIE>');

    const raw = fs.readFileSync(sourceFile, 'utf8');
    const { meta, body } = parseFrontMatter(raw);
    const title = article.title || meta.title || path.basename(sourceFile, '.md');
    const tags = (article.tags && article.tags.length) ? article.tags : (meta.tags || '').split(',').map(s => s.trim()).filter(Boolean);

    // 收集正文中引用的本地图片
    const imgRefs = [...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
      .map(m => m[1])
      .filter(p => !/^https?:/.test(p))
      .map(p => path.resolve(baseDir || path.dirname(sourceFile), p));
    const uniqueImgs = [...new Set(imgRefs)];

    const cookies = cookie.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: '.csdn.net', path: '/', httpOnly: false, secure: true };
    });
    const state = { pending: null, captured: [] };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await ctx.addCookies(cookies);

      // 捕获 OBS 直传回调返回的 CDN URL（挂在 context 上覆盖所有页面）
      ctx.on('response', async resp => {
        const u = resp.url();
        if (u.includes('myhuaweicloud.com')) {
          try {
            const t = await resp.text();
            let url = null;
            try {
              const j = JSON.parse(t);
              url = j?.data?.imageUrl || j?.imageUrl || null;
            } catch (e) {
              const m = t.match(/i-blog\.csdnimg\.cn\/[^\s"<>]+/);
              if (m) url = 'https://' + m[0];
            }
            if (url && state.pending && !state.pending.url) {
              state.pending.url = url;
              state.captured.push({ file: state.pending.file, url });
              this.logger.info(`图片上传成功: ${state.pending.file} -> ${url}`);
            }
          } catch (e) { /* 忽略 */ }
        }
      });

      const page = await ctx.newPage();
      await page.goto('https://editor.csdn.net/md/', { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(4000);

      // 逐个上传图片
      const urlMap = {};
      for (const img of uniqueImgs) {
        try {
          urlMap[path.basename(img)] = await this._uploadOne(ctx, state, img, sleep);
        } catch (e) {
          this.logger.warn(e.message);
        }
      }

      // 用 CDN URL 替换正文本地图片路径
      let finalBody = body;
      for (const [name, url] of Object.entries(urlMap)) {
        finalBody = finalBody.split(name).join(url);
      }
      finalBody = finalBody.replace(/!\[([^\]]*)\]\((?!https?:)[^)]+\)/g, (mm, alt) => `![${alt}](图片上传失败)`);

      // 导入正文（CSDN 导入会替换正文，但不解析 front-matter/标题）
      const tmpMd = path.join(process.cwd(), '.csdn-body-tmp.md');
      fs.writeFileSync(tmpMd, finalBody, 'utf8');
      await page.locator('#import-markdown-file-input').setInputFiles(tmpMd);
      await page.waitForTimeout(3000);
      fs.unlinkSync(tmpMd);

      // 填写标题（输入框 aria-hidden 不可见，用 evaluate 直接设值并派发 input 事件）
      await page.evaluate((t) => {
        const el = document.querySelector('input[placeholder*="标题"]');
        if (!el) return;
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, t);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, title);

      // 填写标签
      if (tags.length) {
        try {
          const tagInput = page.locator('input[placeholder*="标签"], .tag-input input, #article-tag input').first();
          if (await tagInput.count()) {
            for (const t of tags) { await tagInput.fill(t); await page.keyboard.press('Enter'); }
          }
        } catch (e) { this.logger.warn('标签填写跳过: ' + e.message.split('\n')[0]); }
      }

      // 保存草稿：优先点“保存/存草稿”，避免误点“发布文章”导致公开发布
      let saved = false;
      const btns = page.locator('button:visible, [role="button"]:visible');
      const n = await btns.count();
      for (let i = 0; i < n; i++) {
        const t = (await btns.nth(i).innerText()).trim();
        if (['保存草稿', '存草稿', '保存', '草稿'].some(s => t.includes(s)) && !t.includes('发布')) {
          this.logger.info(`点击保存类按钮: ${t}`);
          await btns.nth(i).click();
          saved = true;
          break;
        }
      }
      if (!saved) {
        for (let i = 0; i < n; i++) {
          const t = (await btns.nth(i).innerText()).trim();
          if (t.includes('发布文章') || t.includes('发布')) {
            this.logger.info(`点击发布按钮以打开对话框: ${t}`);
            await btns.nth(i).click();
            await page.waitForTimeout(2000);
            const dlg = page.locator('button:visible');
            const dn = await dlg.count();
            for (let j = 0; j < dn; j++) {
              const dt = (await dlg.nth(j).innerText()).trim();
              if (dt.includes('存草稿') && !dt.includes('发布')) {
                this.logger.info(`在对话框点击: ${dt}`);
                await dlg.nth(j).click();
                saved = true;
                break;
              }
            }
            break;
          }
        }
      }

      await page.waitForTimeout(4000);
      await page.screenshot({ path: path.join(process.cwd(), 'csdn-publish-result.png'), fullPage: false });

      return {
        url: '',
        draft: !!draft,
        message: saved ? '已保存草稿，请在 CSDN 后台“内容管理-文章管理-草稿”确认' : '已尝试保存，请到 CSDN 后台确认草稿',
      };
    } finally {
      await browser.close();
    }
  }

  async listTemplates() {
    return [
      { id: 'default', name: '默认博客', description: '标准技术博客格式' },
      { id: 'deep', name: '深度技术', description: '源码/架构/原理类' },
      { id: 'tutorial', name: '教程实战', description: '步骤演示类' },
    ];
  }

  async getTemplatePrompt() {
    return '# CSDN 写作规范\n\n- 标题 15~35 字\n- 正文 Markdown\n- 字数建议 1500-4000 字';
  }
}

module.exports = CsdnPlatform;
