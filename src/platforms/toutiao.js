/**
 * 头条平台适配器（今日头条）
 * API: https://mp.toutiao.com/mp/toutiao_api
 * 认证: Cookie (sessionid)
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');

class ToutiaoPlatform extends BasePlatform {
  get name() { return '头条'; }
  get id() { return 'toutiao'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://mp.toutiao.com';
  }

  /** 验证凭证 */
  async verify() {
    const cookie = this.config.get('toutiao.cookie');
    if (!cookie) return { valid: false, message: '未配置头条 Cookie' };
    try {
      const { data } = await this.request(`${this.apiBase}/mp/toutiao_api/v1/user/info`, {
        headers: { 'Cookie': cookie },
      });
      if (data.data?.user_info?.name) {
        return { valid: true, message: `Cookie 有效，用户: ${data.data.user_info.name}` };
      }
      return { valid: false, message: data.message || 'Cookie 无效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /** 上传图片到头条 */
  async uploadImage(file) {
    const cookie = this.config.get('toutiao.cookie');
    if (!cookie) throw new Error('头条 Cookie 未配置');
    const img = await this.imageHandler.load(file, process.cwd());
    const cached = this.imageHandler.getCache(img.md5, 'toutiao');
    if (cached) return { url: cached };

    const formData = new FormData();
    formData.append('image', new Blob([img.buffer], { type: img.mimeType }), 'image.png');

    const response = await fetch(`${this.apiBase}/mp/toutiao_api/v1/image/upload`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: formData,
    });
    const data = await response.json();
    if (data.code !== 0 && data.code !== 200) throw new Error(`图片上传失败: ${data.message || JSON.stringify(data)}`);
    const url = data.data?.web_url || data.data?.url;
    if (url) this.imageHandler.setCache(img.md5, 'toutiao', url);
    return { url };
  }

  /**
   * 发布文章到头条
   * 头条支持富文本 HTML
   */
  async publish(article) {
    const { title, content, cover, draft = true, tags, meta } = article;
    const cookie = this.config.get('toutiao.cookie');
    if (!cookie) throw new Error('头条 Cookie 未配置，请运行: content-publisher config set toutiao.cookie <COOKIE>');

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
      abstract: meta?.description || '',
      image: coverUrl,
      tags: tags || [],
      pgc_source: meta?.source || '',
      publish_status: draft ? 2 : 1, // 2=草稿, 1=发布
    };

    const { data } = await this.request(`${this.apiBase}/mp/toutiao_api/v1/article/publish`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: JSON.stringify(payload),
    });

    if (data.code !== 0 && data.code !== 200) throw new Error(`发布失败: ${data.message || JSON.stringify(data)}`);

    return {
      url: data.data?.article_url,
      articleId: data.data?.article_id,
      draft: !!draft,
      message: draft ? '草稿已保存' : '已提交审核',
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
      { id: 'default', name: '默认文章', description: '标准文章格式' },
      { id: 'news', name: '资讯快讯', description: '适合热点/新闻类内容' },
    ];
  }

  async getTemplatePrompt(templateId) {
    return `# 头条 — 默认模板写作规范

## 标题
- 建议 15~30 字，信息密度高
- 可用数字、疑问句增加吸引力

## 正文结构
1. 开篇（痛点/数据引入）
2. 核心内容（小标题分段）
3. 总结

## 格式
- 支持富文本 HTML
- 图片自动上传到头条 CDN

## 字数建议 800-3000 字`;
  }
}

module.exports = ToutiaoPlatform;
