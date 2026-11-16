/**
 * 语雀平台适配器
 * API: https://www.yuque.com/api/v2
 * 认证: Token (Bearer)
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');

class YuquePlatform extends BasePlatform {
  get name() { return '语雀'; }
  get id() { return 'yuque'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://www.yuque.com/api/v2';
  }

  get headers() {
    const token = this.config.get('yuque.token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'content-publisher/1.0',
    };
  }

  /** 验证凭证 */
  async verify() {
    const token = this.config.get('yuque.token');
    if (!token) return { valid: false, message: '未配置语雀 Token' };
    try {
      const { status, data } = await this.request(`${this.apiBase}/user`, { headers: this.headers });
      if (data.data?.id) {
        return { valid: true, message: `Token 有效，用户: ${data.data.name || data.data.login}` };
      }
      return { valid: false, message: data.message || 'Token 无效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /** 上传图片到语雀 */
  async uploadImage(file) {
    const token = this.config.get('yuque.token');
    if (!token) throw new Error('语雀 Token 未配置');
    const img = await this.imageHandler.load(file, process.cwd());
    const cached = this.imageHandler.getCache(img.md5, 'yuque');
    if (cached) return { url: cached };

    // 语雀图片上传
    const formData = new FormData();
    formData.append('file', new Blob([img.buffer], { type: img.mimeType }), 'image.png');

    const response = await fetch(`https://www.yuque.com/api/v2/upload/images`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    const data = await response.json();
    if (data.error) throw new Error(`图片上传失败: ${data.message}`);
    const url = data.data?.url;
    if (url) this.imageHandler.setCache(img.md5, 'yuque', url);
    return { url };
  }

  /**
   * 发布文章到语雀
   * 语雀支持 Markdown 原生格式
   */
  async publish(article) {
    const { title, content, cover, draft = true, tags, meta } = article;
    const token = this.config.get('yuque.token');
    if (!token) throw new Error('语雀 Token 未配置，请运行: content-publisher config set yuque.token <TOKEN>');

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

    // 转换为 Markdown（语雀原生支持）
    const markdownContent = this.htmlToMarkdown(processedContent);

    // 目标仓库路径
    const repoPath = meta?.repoPath || this.config.get('yuque.default-repo') || '';
    if (!repoPath) throw new Error('未配置语雀目标仓库。请运行: content-publisher config set yuque.default-repo <namespace>');

    const payload = {
      title,
      body: markdownContent,
      slug: meta?.slug || title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-'),
      public: !draft,
      format: 'markdown',
    };

    const { data } = await this.request(`${this.apiBase}/repos/${repoPath}/docs`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (data.error) throw new Error(`发布失败: ${data.message}`);

    return {
      url: data.data?.url,
      docId: data.data?.id,
      slug: data.data?.slug,
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
      { id: 'default', name: '默认文档', description: '标准文档格式' },
      { id: 'tech', name: '技术文档', description: 'API 文档/技术方案类' },
      { id: 'knowledge', name: '知识库', description: '知识沉淀/团队 Wiki 类' },
    ];
  }

  async getTemplatePrompt(templateId) {
    const prompts = {
      default: `# 语雀 — 默认模板写作规范

## 标题
- 建议 10~30 字

## 正文结构
1. 开篇引入
2. 核心内容（小标题分段）
3. 总结

## 格式
- Markdown 原生语法
- 语雀对 Markdown 支持完善

## 字数建议 1000-5000 字`,
      tech: `# 语雀 — 技术文档模板

## 适用场景
API 文档 / 技术方案 / 架构设计

## 结构
背景 → 方案 → 实现细节 → 注意事项`,
      knowledge: `# 语雀 — 知识库模板

## 适用场景
知识沉淀 / 团队 Wiki / 最佳实践

## 结构
概述 → 详细内容 → 参考资料`,
    };
    return prompts[templateId] || prompts.default;
  }
}

module.exports = YuquePlatform;
