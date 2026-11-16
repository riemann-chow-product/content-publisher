/**
 * 平台基类
 * 所有平台适配器都应继承此类
 */
'use strict';

const ImageHandler = require('../lib/image');

class BasePlatform {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger || console;
    this.imageHandler = new ImageHandler();
  }

  /** 平台名称（显示用） */
  get name() { return this.constructor.name; }
  /** 平台 ID */
  get id() { return this.name.toLowerCase(); }

  /**
   * 发布文章
   * @param {Object} article
   * @param {string} article.title - 标题
   * @param {string} article.content - HTML 或 Markdown 正文
   * @param {string} [article.cover] - 封面图片路径/URL
   * @param {string} [article.template] - 模板 ID
   * @param {boolean} [article.draft] - 是否草稿
   * @param {string[]} [article.tags] - 标签
   * @param {Object} [article.meta] - Front-matter 元数据
   * @returns {Promise<{url?: string, draftUrl?: string, mediaId?: string}>}
   */
  async publish(article) {
    throw new Error('子类必须实现 publish 方法');
  }

  /**
   * 上传单张图片，返回 CDN URL
   * @param {string} file - 图片路径或 URL
   * @returns {Promise<{url: string, mediaId?: string}>}
   */
  async uploadImage(file) {
    throw new Error('子类必须实现 uploadImage 方法');
  }

  /**
   * 发布图文消息（图片集）
   * @param {Object} params
   * @returns {Promise<any>}
   */
  async publishNewspic(params) {
    throw new Error('子类未实现 publishNewspic');
  }

  /**
   * 列出可用模板
   * @returns {Promise<Array<{id, name, description}>>}
   */
  async listTemplates() {
    return [];
  }

  /**
   * 获取模板写作规范
   * @param {string} templateId
   * @returns {Promise<string>}
   */
  async getTemplatePrompt(templateId) {
    return '';
  }

  /**
   * 验证凭证是否有效
   * @returns {Promise<{valid: boolean, message?: string}>}
   */
  async verify() {
    return { valid: false, message: '子类必须实现 verify 方法' };
  }

  /**
   * 获取访问令牌（各平台不同实现）
   */
  async getAccessToken() {
    throw new Error('子类必须实现 getAccessToken');
  }

  /**
   * HTTP 请求封装
   * @param {string} url
   * @param {Object} options
   */
  async request(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });
    const data = await response.json();
    return { status: response.status, data };
  }
}

module.exports = BasePlatform;
