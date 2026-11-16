/**
 * 知乎平台适配器
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');

class ZhihuPlatform extends BasePlatform {
  get name() { return '知乎'; }
  get id() { return 'zhihu'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://www.zhihu.com/api/v4';
  }

  get headers() {
    const token = this.config.get('zhihu.token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'content-publisher/1.0',
      'X-Api-Version': '3.0.91',
    };
  }

  /** 验证凭证 */
  async verify() {
    const token = this.config.get('zhihu.token');
    if (!token) {
      return { valid: false, message: '未配置知乎 Token' };
    }
    try {
      const { status, data } = await this.request(`${this.apiBase}/account/settings`, {
        headers: this.headers,
      });
      return status === 200
        ? { valid: true, message: 'Token 有效' }
        : { valid: false, message: data.error || 'Token 无效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /** 上传图片 */
  async uploadImage(file) {
    const token = this.config.get('zhihu.token');
    if (!token) throw new Error('知乎 Token 未配置');

    const img = await this.imageHandler.load(file, process.cwd());
    const cached = this.imageHandler.getCache(img.md5, 'zhihu');
    if (cached) return { url: cached };

    // 知乎图片上传接口
    const formData = new FormData();
    const blob = new Blob([img.buffer], { type: img.mimeType });
    formData.append('img', blob, 'image.jpg');

    const response = await fetch('https://api.zhihu.com/images', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`图片上传失败: ${response.status}`);
    }

    const data = await response.json();
    const url = data.url || data.image;
    if (url) {
      this.imageHandler.setCache(img.md5, 'zhihu', url);
    }

    return { url };
  }

  /**
   * 发布文章到知乎专栏
   */
  async publish(article) {
    const { title, content, cover, draft = true, tags, meta } = article;
    const token = this.config.get('zhihu.token');
    if (!token) throw new Error('知乎 Token 未配置，请运行: content-publisher config set zhihu.token <TOKEN>');

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

    // 知乎接受 Markdown 原生格式，HTML 转换回去
    const markdownContent = this.htmlToMarkdown(processedContent);

    // 发布专栏文章
    const payload = {
      title,
      content: markdownContent,
      tags: tags || [],
      is_column: false,
      isdraft: draft,
    };

    const columnId = this.config.get('zhihu.default-column');
    const endpoint = columnId
      ? `${this.apiBase}/columns/${columnId}/articles`
      : `${this.apiBase}/articles`;

    const { status, data } = await this.request(endpoint, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });

    if (status !== 200) {
      throw new Error(`发布失败: ${data.error || data.msg || status}`);
    }

    return {
      url: data.url,
      draftUrl: `https://www.zhihu.com/author/drafts/${data.id}`,
      articleId: data.id,
    };
  }

  /**
   * HTML → Markdown 简化转换（知乎专栏支持 Markdown）
   */
  htmlToMarkdown(html) {
    return html
      .replace(/<h1>(.+?)<\/h1>/gi, '# $1')
      .replace(/<h2>(.+?)<\/h2>/gi, '## $1')
      .replace(/<h3>(.+?)<\/h3>/gi, '### $1')
      .replace(/<strong><em>(.+?)<\/em><\/strong>/gi, '***$1***')
      .replace(/<strong>(.+?)<\/strong>/gi, '**$1**')
      .replace(/<em>(.+?)<\/em>/gi, '*$1*')
      .replace(/<del>(.+?)<\/del>/gi, '~~$1~~')
      .replace(/<a href="([^"]+)">(.+?)<\/a>/gi, '[$2]($1)')
      .replace(/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, `![$2]($1)`)
      .replace(/<img[^>]+alt="([^"]*)"[^>]+src="([^"]+)"[^>]*>/gi, `![$1]($2)`)
      .replace(/<img[^>]+src="([^"]+)"[^>]*>/gi, `![]($1)`)
      .replace(/<blockquote>(.+?)<\/blockquote>/gi, '> $1')
      .replace(/<code>(.+?)<\/code>/gi, '`$1`')
      .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```')
      .replace(/<p>(.+?)<\/p>/gi, '$1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  /** 列出模板 */
  async listTemplates() {
    return [
      { id: 'default', name: '默认专栏', description: '标准文章格式，适合干货、观点类' },
      { id: 'qa', name: '问答格式', description: '先说结论，再分析原因，适合回答类' },
      { id: 'list', name: '清单体', description: '分点列举，适合教程、推荐类' },
    ];
  }

  /** 获取模板写作规范 */
  async getTemplatePrompt(templateId) {
    const prompts = {
      default: `# 知乎专栏 — 默认模板写作规范

## 开头
知乎用户习惯先看结论。建议结构：
> **太长不看**：先给结论，一句话总结

## 正文
- 用小标题（##）分段
- 每个观点给证据（数据、案例、引用）
- 善用「引用」格式强调重点

## 结尾
- 总结核心观点
- 引导评论互动（"你遇到过类似情况吗？"）

## 格式
- 加粗：**加粗**
- 引用：> 引用文字
- 代码：\`code\`

## 标签
建议添加 3~5 个相关话题标签`,

      qa: `# 知乎 — 问答格式写作规范

## 结论先行
知乎高赞回答的特点：结论 + 原因 + 案例

## 结构
1. **结论**（一句话说清楚）
2. **原因**（为什么是这个结论）
3. **案例**（自己的经历或他人案例）
4. **参考**（延伸阅读/数据来源）`,

      list: `# 知乎 — 清单体写作规范

## 结构
开篇引入 → 逐条展开（每条 100-300 字）→ 总结

## 每条规范
- 编号或 emoji 开头
- 一句话标题（吸引眼球）
- 解释说明
- 示例（可选）

## 数量
建议 5~15 条为宜`,

      default: `# 知乎专栏 — 默认规范`,
    };
    return prompts[templateId] || prompts.default;
  }
}

module.exports = ZhihuPlatform;
