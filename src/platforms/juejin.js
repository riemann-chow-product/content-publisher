/**
 * 掘金平台适配器
 * API: https://api.juejin.cn/content_api/v1/article
 * 认证: Cookie (SSO / SESSDATA)
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');

class JuejinPlatform extends BasePlatform {
  get name() { return '掘金'; }
  get id() { return 'juejin'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://api.juejin.cn';
  }

  /** 验证凭证（Cookie） */
  async verify() {
    const cookie = this.config.get('juejin.cookie');
    if (!cookie) return { valid: false, message: '未配置掘金 Cookie' };
    try {
      const { status, data } = await this.request(`${this.apiBase}/user_api/v1/user/get`, {
        headers: { 'Cookie': cookie },
      });
      if (data.err_no === 0 && data.data?.user_name) {
        return { valid: true, message: `Cookie 有效，用户: ${data.data.user_name}` };
      }
      return { valid: false, message: data.err_msg || 'Cookie 无效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /** 上传图片到掘金 */
  async uploadImage(file) {
    const cookie = this.config.get('juejin.cookie');
    if (!cookie) throw new Error('掘金 Cookie 未配置');
    const img = await this.imageHandler.load(file, process.cwd());
    const cached = this.imageHandler.getCache(img.md5, 'juejin');
    if (cached) return { url: cached };

    const formData = new FormData();
    formData.append('file', new Blob([img.buffer], { type: img.mimeType }), 'image.png');
    formData.append('file_type', '1');

    const response = await fetch(`${this.apiBase}/content_api/v1/upload_img`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: formData,
    });
    const data = await response.json();
    if (data.err_no !== 0) throw new Error(`图片上传失败: ${data.err_msg}`);
    const url = data.data?.url || data.data?.image_url;
    if (url) this.imageHandler.setCache(img.md5, 'juejin', url);
    return { url };
  }

  /**
   * 发布文章到掘金
   * 掘金支持 Markdown + HTML 混合
   */
  async publish(article) {
    const { title, content, cover, draft = true, tags, meta } = article;
    const cookie = this.config.get('juejin.cookie');
    if (!cookie) throw new Error('掘金 Cookie 未配置，请运行: content-publisher config set juejin.cookie <COOKIE>');

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

    // 掘金接受 Markdown 原生格式
    const markdownContent = this.htmlToMarkdown(processedContent);

    // 获取分类 ID
    const categoryId = meta?.categoryId || this.config.get('juejin.default-category') || '6809637769959178243';

    const payload = {
      title,
      mark_content: markdownContent,
      cover_image: cover || '',
      content_type: 1, // 1=markdown
      category_id: categoryId,
      tags: tags || [],
      draft_status: draft ? 1 : 0,
    };

    const { status, data } = await this.request(`${this.apiBase}/content_api/v1/article/publish`, {
      method: 'POST',
      headers: { 'Cookie': cookie },
      body: JSON.stringify(payload),
    });

    if (data.err_no !== 0) throw new Error(`发布失败: ${data.err_msg}`);

    return {
      url: draft ? undefined : `https://juejin.cn/post/${data.data?.article_id}`,
      articleId: data.data?.article_id,
      draft: !!draft,
      message: draft ? '草稿已保存，请在掘金后台查看' : '已发布',
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
      { id: 'default', name: '默认文章', description: '标准技术文章格式' },
      { id: 'deep', name: '深度解析', description: '源码/架构/原理类深度内容' },
      { id: 'tutorial', name: '教程实战', description: '步骤演示/环境搭建类' },
    ];
  }

  async getTemplatePrompt(templateId) {
    const prompts = {
      default: `# 掘金 — 默认模板写作规范

## 标题
- 建议 15~30 字，技术关键词前置
- 推荐格式：\`XXX 原理详解 | 从入门到精通\`
- 可用 emoji 增加吸引力

## 正文结构
1. **开篇**：痛点或数据引入（100-200字）
2. **核心**：小标题分段，每段 200-500 字
3. **结尾**：总结 + 引导互动

## 格式
- Markdown 原生语法
- 代码块标注语言类型 (\`\`\`javascript)
- 表格用 Markdown 表格语法

## 配图
- 每 300-500 字配一张图
- 图片自动上传到掘金 CDN

## 字数
- 建议 1500-4000 字`,
      deep: `# 掘金 — 深度解析模板

## 适用场景
源码分析 / 架构设计 / 系统原理 / 技术选型

## 结构
1. 背景（为什么需要了解这个）
2. 核心原理（主体，分多个 ## 小节）
3. 关键代码/架构图
4. 对比分析（优缺点、适用场景）
5. 总结与延伸

## 字数建议 2500-6000 字`,
      tutorial: `# 掘金 — 教程实战模板

## 适用场景
步骤演示 / 环境搭建 / 入门指南

## 结构
1. 目标说明
2. 环境准备
3. 步骤详解（每步含命令和预期结果）
4. 常见问题 FAQ
5. 验证与总结

## 字数建议 1500-3500 字`,
    };
    return prompts[templateId] || prompts.default;
  }
}

module.exports = JuejinPlatform;
