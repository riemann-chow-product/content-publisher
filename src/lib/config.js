/**
 * 配置管理
 * 支持全局配置 + Profile 隔离 + 多平台
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SCHEMA = {
  // 微信公众号
  'wechat.appid': { type: 'string' },
  'wechat.appsecret': { type: 'string' },
  'wechat.default-template': { type: 'string' },
  'wechat.default-author': { type: 'string' },

  // 知乎
  'zhihu.token': { type: 'string' },
  'zhihu.cookies': { type: 'string' },
  'zhihu.default-column': { type: 'string' },

  // 微博
  'weibo.uid': { type: 'string' },
  'weibo.cookies': { type: 'string' },

  // 全局
  'global.default-platform': { type: 'string', default: 'wechat' },
  'global.default-cover': { type: 'string' },
  'global.editor': { type: 'string' },
  'global.open-after-publish': { type: 'boolean', default: false },
};

// 简单的 JSON 配置存储（替代 conf 包，避免 ESM 问题）
class SimpleStore {
  constructor(projectName) {
    this.configPath = path.join(os.homedir(), `.${projectName}`, 'config.json');
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (e) {
      console.warn('加载配置失败:', e.message);
    }
    return {};
  }

  _save() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2));
  }

  get(key, defaultValue) {
    return this.data[key] ?? defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  delete(key) {
    delete this.data[key];
    this._save();
  }

  get store() {
    return this.data;
  }
}

class Config {
  constructor({ profile } = {}) {
    this.store = new SimpleStore('content-publisher');
    this._profile = profile || null;
  }

  // 获取当前激活的 profile
  get activeProfile() {
    return this._profile || this.store.get('_activeProfile', 'default');
  }

  // 读取配置（支持嵌套 key 如 wechat.appid）
  get(key, fallback) {
    // Profile 优先
    if (this._profile) {
      const profileVal = this.store.get(`profiles.${this._profile}.${key}`);
      if (profileVal !== undefined) return profileVal;
    }
    return this.store.get(key, fallback);
  }

  // 写配置
  set(key, value) {
    if (this._profile) {
      this.store.set(`profiles.${this._profile}.${key}`, value);
    } else {
      this.store.set(key, value);
    }
  }

  // 删除配置
  delete(key) {
    this.store.delete(key);
  }

  // 列出所有配置（合并后的）
  list() {
    const profile = this.activeProfile;
    const global = this.store.store;
    const profileData = this.store.get(`profiles.${profile}`, {});

    return {
      _activeProfile: profile,
      ...global,
      ...profileData,
    };
  }

  // Profile 管理
  listProfiles() {
    return Object.keys(this.store.get('profiles', {}));
  }

  addProfile(name) {
    const profiles = this.store.get('profiles', {});
    profiles[name] = {};
    this.store.set('profiles', profiles);
  }

  useProfile(name) {
    this._profile = name;
    this.store.set('_activeProfile', name);
  }

  deleteProfile(name) {
    const profiles = this.store.get('profiles', {});
    delete profiles[name];
    this.store.set('profiles', profiles);
  }

  // 验证指定平台的凭证
  async verify(platform) {
    const p = require(`../platforms/${platform}`);
    const instance = new p({ config: this });
    return instance.verify();
  }
}

module.exports = Config;
