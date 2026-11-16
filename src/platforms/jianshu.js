/**
 * 简书平台适配器
 * API: https://www.jianshu.com/api/v1
 * 认证: Cookie (session)
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');

class JianshuPlatform extends BasePlatform {
  get name() { return '简书'; }
  get id() { return 'jianshu'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://www.jianshu.com';
  }

  /** 验证凭证 */
  async verify() {
    const cookie = this.config.get('jianshu.cookie');
    if (!cookie) return { valid: false, message: '未配置简书 Cookie' };
    try {
      const { data } = await this.request(`${this.apiBase}/api/v1/users/me`, {
        headers: { 'Cookie': cookie },
      });
      if (data.id && data.nickname) {
        return { valid: true, message: `Cookie 有效，用户: ${data.nickname}` };
      }
      return { valid: false, message: 'Cookie 无效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /** 上传图片到简书 */
  async uploadImage(file) {
    const cookie = this.config.get('jianshu.cookie');
    if (!cookie) throw new Error('简书 Cookie 未配置');
    const img = await this.imageHandler.load(file, process.cwd());
    const cached = this.imageHandler.getCache(img.md5, 'jianshu');
    if (cached) return { url: cached };

    // 简书图片上传
    const formData = new FormData();
    formData.append('image', new Blob([img.buffer], { type: img.mimeType }), 'image.png');

    const response = await fetch(`${this.apiBase}/api/v1/images/upload`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: formData,
    });
    const data = await response.json();
    if (!data.url) throw new Error(`图片上传失败`);
    this.imageHandler.setCache(img.md5, 'jianshu', data.url);
    return { url: data.url };
  }

  /**
   * 发布文章到简书
   * 简书支持 Markdown 原生格式
   */
  async publish(article) {
    const { title, content, cover, draft = true, tags, meta } = article;
    const cookie = this.config.get('jianshu.cookie');
    if (!cookie) throw new Error('简书 Cookie 未配置，请运行: content-publisher config set jianshu.cookie <COOKIE>');

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

    // 转换为 Markdown
    const markdownContent = this.htmlToMarkdown(processedContent);

    const payload = {
      title,
      content: markdownContent,
      tags: tags || [],
      is_public: !draft,
    };

    const { data } = await this.request(`${this.apiBase}/api/v1/notes`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: JSON.stringify(payload),
    });

    if (data.errors) throw new Error(`发布失败: ${JSON.stringify(data.errors)}`);

    return {
      url: data.slug ? `https://www.jianshu.com/p/${data.slug}` : undefined,
      noteId: data.id,
      slug: data.slug,
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
      { id: 'default', name: '默认文章', description: '标准文章格式' },
      { id: 'story', name: '故事体', description: '叙事风格，适合经验分享' },
    ];
  }

  async getTemplatePrompt(templateId) {
    return `# 简书 — 默认模板写作规范

## 标题
- 建议 10~30 字
- 简洁有力

## 正文结构
1. 开篇引入
2. 核心内容（小标题分段）
3. 总结 + 引导互动

## 格式
- Markdown 原生语法
- 简书对 HTML 支持有限，建议纯 Markdown

## 字数建议 1000-3000 字`;
  }
}

module.exports = JianshuPlatform;
