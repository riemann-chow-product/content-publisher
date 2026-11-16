/**
 * 开源中国（OSChina）平台适配器
 * API: https://www.oschina.net/action
 * 认证: Cookie (session)
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');

class OschinaPlatform extends BasePlatform {
  get name() { return '开源中国'; }
  get id() { return 'oschina'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://my.oschina.net';
    this.blogApi = 'https://www.oschina.net/action';
  }

  /** 验证凭证 */
  async verify() {
    const cookie = this.config.get('oschina.cookie');
    if (!cookie) return { valid: false, message: '未配置开源中国 Cookie' };
    try {
      const { data } = await this.request(`${this.apiBase}/action/api/user_info`, {
        headers: { 'Cookie': cookie },
      });
      if (data.code === 1 && data.result?.name) {
        return { valid: true, message: `Cookie 有效，用户: ${data.result.name}` };
      }
      return { valid: false, message: data.message || 'Cookie 无效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /** 上传图片到开源中国 */
  async uploadImage(file) {
    const cookie = this.config.get('oschina.cookie');
    if (!cookie) throw new Error('开源中国 Cookie 未配置');
    const img = await this.imageHandler.load(file, process.cwd());
    const cached = this.imageHandler.getCache(img.md5, 'oschina');
    if (cached) return { url: cached };

    // 开源中国图片上传
    const formData = new FormData();
    formData.append('file', new Blob([img.buffer], { type: img.mimeType }), 'image.png');

    const response = await fetch(`${this.apiBase}/action/api/upload_image`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: formData,
    });
    const data = await response.json();
    if (data.code !== 1 && data.code !== undefined) throw new Error(`图片上传失败: ${data.message}`);
    const url = data.result?.url || data.url;
    if (url) this.imageHandler.setCache(img.md5, 'oschina', url);
    return { url };
  }

  /**
   * 发布文章到开源中国
   * 支持富文本 HTML
   */
  async publish(article) {
    const { title, content, cover, draft = true, tags, meta } = article;
    const cookie = this.config.get('oschina.cookie');
    if (!cookie) throw new Error('开源中国 Cookie 未配置，请运行: content-publisher config set oschina.cookie <COOKIE>');

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

    const payload = {
      title,
      content: processedContent,
      tags: tags || [],
      categories: meta?.categories || [],
      draft: draft ? 1 : 0,
    };

    const { data } = await this.request(`${this.apiBase}/action/blog/save`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: JSON.stringify(payload),
    });

    if (data.code !== 1 && data.code !== undefined) throw new Error(`发布失败: ${data.message}`);

    return {
      url: data.result?.url,
      blogId: data.result?.id,
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
      { id: 'default', name: '默认文章', description: '标准博客格式' },
      { id: 'open-source', name: '开源项目', description: '项目介绍/源码分析类' },
    ];
  }

  async getTemplatePrompt(templateId) {
    const prompts = {
      default: `# 开源中国 — 默认模板写作规范

## 标题
- 建议 15~30 字

## 正文结构
1. 开篇引入
2. 核心内容（小标题分段）
3. 总结

## 格式
- 支持富文本 HTML 和 Markdown

## 字数建议 1000-4000 字`,
      'open-source': `# 开源中国 — 开源项目模板

## 适用场景
项目介绍 / 源码分析 / 技术选型

## 结构
项目概述 → 核心特性 → 架构分析 → 使用指南`,
    };
    return prompts[templateId] || prompts.default;
  }
}

module.exports = OschinaPlatform;
