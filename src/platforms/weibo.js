/**
 * 微博平台适配器
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');

class WeiboPlatform extends BasePlatform {
  get name() { return '微博'; }
  get id() { return 'weibo'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://api.weibo.com/2';
  }

  get headers() {
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'content-publisher/1.0',
    };
  }

  /** 验证凭证 */
  async verify() {
    const uid = this.config.get('weibo.uid');
    if (!uid) return { valid: false, message: '未配置微博 UID' };
    try {
      const token = await this.getAccessToken();
      return { valid: true, message: '凭证有效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /** 获取 access_token（简化版，需要 OAuth） */
  async getAccessToken() {
    const token = this.config.get('weibo.access_token');
    if (!token) throw new Error('微博 access_token 未配置');
    return token;
  }

  /** 上传图片到微博 */
  async uploadImage(file) {
    const token = await this.getAccessToken();
    const img = await this.imageHandler.load(file, process.cwd());
    const cached = this.imageHandler.getCache(img.md5, 'weibo');
    if (cached) return { url: cached };

    const formData = new FormData();
    const blob = new Blob([img.buffer], { type: img.mimeType });
    formData.append('pic', blob, 'image.jpg');

    const response = await fetch(`${this.apiBase}/statuses/upload.json?access_token=${token}`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    if (data.error) throw new Error(`图片上传失败: ${data.error}`);

    const url = data.url || data.pic_url;
    if (url) this.imageHandler.setCache(img.md5, 'weibo', url);

    return { url, mediaId: data.pid };
  }

  /**
   * 发布微博
   * 微博限制：文本 2000 字，配图最多 9 张
   */
  async publish(article) {
    const { title, content, cover, draft = false, tags } = article;
    const token = await this.getAccessToken();

    // 微博正文只用纯文本，限制 2000 字
    const plainContent = this.htmlToPlain(content);
    const truncated = plainContent.slice(0, 2000);

    let imageIds = [];

    // 上传封面图（如果有）
    if (cover) {
      const result = await this.uploadImage(cover);
      imageIds.push(result.mediaId);
    }

    // 构建微博内容
    const weiboText = title ? `${title}\n\n${truncated}` : truncated;
    const tagText = tags?.length ? '\n\n' + tags.map(t => `#${t}#`).join(' ') : '';

    const payload = new URLSearchParams({
      access_token: token,
      status: weiboText + tagText,
    });

    const url = imageIds.length > 0
      ? `${this.apiBase}/statuses/upload.json`
      : `${this.apiBase}/statuses/update.json`;

    const body = imageIds.length > 0
      ? { ...Object.fromEntries(payload), pic: imageIds[0] }
      : Object.fromEntries(payload);

    const response = await fetch(url, {
      method: 'POST',
      body: payload,
    });

    const data = await response.json();
    if (data.error) throw new Error(`发布失败: ${data.error}`);

    return {
      url: `https://weibo.com/${data.user?.idstr || data.user_id}/profile/${data.id}`,
      weiboId: data.id,
    };
  }

  htmlToPlain(html) {
    return html
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** 列出模板 */
  async listTemplates() {
    return [
      { id: 'default', name: '普通微博', description: '短文 + 图片，适合日常分享' },
      { id: 'long', name: '长微博', description: '配合头条文章，适合深度内容' },
    ];
  }

  /** 获取模板写作规范 */
  async getTemplatePrompt(templateId) {
    return `# 微博写作规范

## 限制
- 文本不超过 2000 字
- 配图最多 9 张
- 配图会自动压缩

## 技巧
- 开头要有「钩子」（数字、疑问、冲突）
- 善用 #话题标签#
- 结尾引导互动（投票、评论）

## 格式
- 微博不需要 Markdown
- 直接写纯文本即可`;
  }
}

module.exports = WeiboPlatform;
