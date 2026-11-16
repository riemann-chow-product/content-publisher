/**
 * 思否（SegmentFault）平台适配器
 * API: https://segmentfault.com/api/v2
 * 认证: Cookie (SF_SESSION)
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');

class SifouPlatform extends BasePlatform {
  get name() { return '思否'; }
  get id() { return 'sifou'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://segmentfault.com/api/v2';
  }

  /** 验证凭证 */
  async verify() {
    const cookie = this.config.get('sifou.cookie');
    if (!cookie) return { valid: false, message: '未配置思否 Cookie' };
    try {
      const { data } = await this.request(`${this.apiBase}/user/info`, {
        headers: { 'Cookie': cookie },
      });
      if (data.status === 0 && data.data?.name) {
        return { valid: true, message: `Cookie 有效，用户: ${data.data.name}` };
      }
      return { valid: false, message: data.error || 'Cookie 无效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /** 上传图片到思否 */
  async uploadImage(file) {
    const cookie = this.config.get('sifou.cookie');
    if (!cookie) throw new Error('思否 Cookie 未配置');
    const img = await this.imageHandler.load(file, process.cwd());
    const cached = this.imageHandler.getCache(img.md5, 'sifou');
    if (cached) return { url: cached };

    // 思否图片上传
    const formData = new FormData();
    formData.append('file', new Blob([img.buffer], { type: img.mimeType }), 'image.png');

    const response = await fetch(`https://segmentfault.com/api/v2/image/upload`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: formData,
    });
    const data = await response.json();
    if (data.status !== 0) throw new Error(`图片上传失败: ${data.error}`);
    const url = data.data?.url;
    if (url) this.imageHandler.setCache(img.md5, 'sifou', url);
    return { url };
  }

  /**
   * 发布文章到思否
   * 支持富文本 HTML
   */
  async publish(article) {
    const { title, content, cover, draft = true, tags, meta } = article;
    const cookie = this.config.get('sifou.cookie');
    if (!cookie) throw new Error('思否 Cookie 未配置，请运行: content-publisher config set sifou.cookie <COOKIE>');

    // 处理正文图片
    let processedContent = content;
    if (content.includes('<img')) {
      const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
      let match;
      while ((match = imgRegex.exec(content)) !== null) {
        const src = match[1];
        if (!src.startsWith('http')) {
          try {
            const result = await this.uploadImage(src);
            processedContent = processedContent.replace(src, result.url);
          } catch (e) {
            this.logger.warn(`图片上传失败: ${src}`);
          }
        }
      }
    }

    // 转换为 Markdown（思否支持 Markdown）
    const markdownContent = this.htmlToMarkdown(processedContent);

    const payload = {
      title,
      text: markdownContent,
      url: article.sourceUrl || '',
      blogId: meta?.blogId || '',
      isDraft: draft ? 1 : 0,
      license: meta?.license || 'cc',
      tags: tags || [],
    };

    const { data } = await this.request(`${this.apiBase}/article/draft`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: JSON.stringify(payload),
    });

    if (data.status !== 0 && data.status !== undefined) throw new Error(`发布失败: ${data.error}`);

    return {
      url: data.data?.url,
      articleId: data.data?.id,
      draft: !!draft,
      message: draft ? '草稿已保存' : '已发布',
    };
  }

  htmlToMarkdown(html) {
    return html
      .replace(/<h1[^>]*>(.+?)<\/h1>/gi, '# $1')
      .replace(/<h2[^>]*>(.+?)<\/h2>/gi, '## $1')
      .replace(/<h3[^>]*>(.+?)<\/h3>/gi, '### $1')
      .replace(/<strong><em>(.+?)<\/em><\/strong>/gi, '***$1***')
      .replace(/<strong>(.+?)<\/strong>/gi, '**$1**')
      .replace(/<em>(.+?)<\/em>/gi, '*$1*')
      .replace(/<a href="([^"]+)">(.+?)<\/a>/gi, '[$2]($1)')
      .replace(/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)')
      .replace(/<img[^>]+src="([^"]+)"[^>]*>/gi, '![]($1)')
      .replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, '> $1')
      .replace(/<code>(.+?)<\/code>/gi, '`$1`')
      .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```')
      .replace(/<p>([\s\S]*?)<\/p>/gi, '$1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<section[^>]*>([\s\S]*?)<\/section>/gi, '$1')
      .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  async listTemplates() {
    return [
      { id: 'default', name: '默认文章', description: '标准问答/文章格式' },
      { id: 'qa', name: '问答格式', description: '问题解答类内容' },
    ];
  }

  async getTemplatePrompt(templateId) {
    const prompts = {
      default: `# 思否 — 默认模板写作规范

## 标题
- 建议 15~30 字，技术关键词前置

## 正文结构
1. 开篇引入
2. 核心内容（小标题分段）
3. 总结 + 引导互动

## 格式
- 支持 Markdown 和 HTML 混合
- 代码块标注语言类型

## 字数建议 1000-4000 字`,
      qa: `# 思否 — 问答格式模板

## 适用场景
技术问题解答 / 排查记录

## 结构
问题描述 → 分析过程 → 解决方案 → 总结`,
    };
    return prompts[templateId] || prompts.default;
  }
}

module.exports = SifouPlatform;
