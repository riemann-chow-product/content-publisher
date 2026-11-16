/**
 * 51CTO 平台适配器
 * API: https://blog.51cto.com/api
 * 认证: Cookie (session)
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');

class Cto51Platform extends BasePlatform {
  get name() { return '51CTO'; }
  get id() { return '51cto'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://blog.51cto.com';
  }

  /** 验证凭证 */
  async verify() {
    const cookie = this.config.get('51cto.cookie');
    if (!cookie) return { valid: false, message: '未配置 51CTO Cookie' };
    try {
      const { data } = await this.request(`${this.apiBase}/api/user/info`, {
        headers: { 'Cookie': cookie },
      });
      if (data.code === 200 && data.data?.username) {
        return { valid: true, message: `Cookie 有效，用户: ${data.data.username}` };
      }
      return { valid: false, message: data.msg || 'Cookie 无效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /** 上传图片到 51CTO */
  async uploadImage(file) {
    const cookie = this.config.get('51cto.cookie');
    if (!cookie) throw new Error('51CTO Cookie 未配置');
    const img = await this.imageHandler.load(file, process.cwd());
    const cached = this.imageHandler.getCache(img.md5, '51cto');
    if (cached) return { url: cached };

    const formData = new FormData();
    formData.append('file', new Blob([img.buffer], { type: img.mimeType }), 'image.png');

    const response = await fetch(`${this.apiBase}/api/image/upload`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: formData,
    });
    const data = await response.json();
    if (data.code !== 200) throw new Error(`图片上传失败: ${data.msg}`);
    const url = data.data?.url;
    if (url) this.imageHandler.setCache(img.md5, '51cto', url);
    return { url };
  }

  /**
   * 发布文章到 51CTO
   * 支持富文本 HTML
   */
  async publish(article) {
    const { title, content, cover, draft = true, tags, meta } = article;
    const cookie = this.config.get('51cto.cookie');
    if (!cookie) throw new Error('51CTO Cookie 未配置，请运行: content-publisher config set 51cto.cookie <COOKIE>');

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

    // 上传封面图
    let coverUrl = cover || '';
    if (cover && !cover.startsWith('http')) {
      try {
        const result = await this.uploadImage(cover);
        coverUrl = result.url;
      } catch (e) {
        this.logger.warn(`封面上传失败: ${e.message}`);
      }
    }

    const payload = {
      title,
      content: processedContent,
      description: meta?.description || '',
      image: coverUrl,
      tags: tags || [],
      categories: meta?.categories || [],
      status: draft ? 'draft' : 'publish',
    };

    const { data } = await this.request(`${this.apiBase}/api/article/publish`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: JSON.stringify(payload),
    });

    if (data.code !== 200 && data.code !== 201) throw new Error(`发布失败: ${data.msg}`);

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
      { id: 'default', name: '默认文章', description: '标准技术博客格式' },
      { id: 'tutorial', name: '教程实战', description: '步骤演示类' },
    ];
  }

  async getTemplatePrompt(templateId) {
    const prompts = {
      default: `# 51CTO — 默认模板写作规范

## 标题
- 建议 15~30 字，技术关键词前置

## 正文结构
1. 开篇（痛点引入）
2. 核心内容（小标题分段）
3. 总结 + 引导互动

## 格式
- 支持富文本 HTML
- 代码块标注语言类型

## 字数建议 1500-4000 字`,
      tutorial: `# 51CTO — 教程实战模板

## 适用场景
步骤演示 / 环境搭建 / 入门指南

## 结构
目标说明 → 环境准备 → 步骤详解 → FAQ → 验证总结

## 字数建议 1500-3500 字`,
    };
    return prompts[templateId] || prompts.default;
  }
}

module.exports = Cto51Platform;
