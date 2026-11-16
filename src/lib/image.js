/**
 * 图片处理工具
 * 负责图片路径解析、大小压缩、缓存、格式转换
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB（大多数平台限制）

class ImageHandler {
  constructor({ cacheDir } = {}) {
    this.cacheDir = cacheDir || path.join(os.homedir(), '.content-publisher', 'image-cache');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 加载图片（支持本地路径和 URL）
   * @param {string} src - 图片路径或 URL
   * @param {string} baseDir - 相对路径基准目录
   * @returns {Promise<{buffer: Buffer, mimeType: string, path: string}>}
   */
  async load(src, baseDir) {
    if (/^https?:\/\//.test(src)) {
      return this.loadFromUrl(src);
    }
    return this.loadFromFile(src, baseDir);
  }

  async loadFromFile(filePath, baseDir) {
    let resolved = filePath;

    // 相对路径 → 基于 baseDir 解析
    if (!path.isAbsolute(filePath)) {
      const searchPaths = [
        baseDir,
        path.join(baseDir, 'assets'),
        path.join(baseDir, '..', 'assets'),
        path.join(process.cwd()),
        path.join(process.cwd(), 'assets'),
      ];

      for (const dir of searchPaths) {
        const candidate = path.join(dir, filePath);
        if (fs.existsSync(candidate)) {
          resolved = candidate;
          break;
        }
      }
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`图片文件不存在: ${resolved}`);
    }

    const buffer = fs.readFileSync(resolved);
    const ext = path.extname(resolved).slice(1).toLowerCase();
    const mimeType = this.getMimeType(ext);

    return {
      buffer,
      mimeType,
      path: resolved,
      size: buffer.length,
      md5: this.md5(buffer),
    };
  }

  async loadFromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载图片失败: ${url} (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = this.extFromUrl(url);
    const mimeType = this.getMimeType(ext);

    return {
      buffer,
      mimeType,
      path: url,
      size: buffer.length,
      md5: this.md5(buffer),
    };
  }

  /**
   * 获取图片 MD5（用于缓存 key）
   */
  md5(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  /**
   * 检查缓存
   * @returns {string|null} 缓存的 CDN URL
   */
  getCache(md5, platform) {
    const cacheFile = path.join(this.cacheDir, `${platform}-${md5}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        // 缓存默认 7 天有效
        if (Date.now() - data.timestamp < 7 * 24 * 60 * 60 * 1000) {
          return data.url;
        }
      } catch (e) {
        // 忽略
      }
    }
    return null;
  }

  /**
   * 写入缓存
   */
  setCache(md5, platform, url) {
    const cacheFile = path.join(this.cacheDir, `${platform}-${md5}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify({ url, timestamp: Date.now() }, null, 2));
  }

  /**
   * 清理过期缓存
   */
  cleanCache() {
    const files = fs.readdirSync(this.cacheDir);
    let cleaned = 0;
    for (const file of files) {
      if (file.endsWith('.json')) {
        const cacheFile = path.join(this.cacheDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
          if (Date.now() - data.timestamp > 7 * 24 * 60 * 60 * 1000) {
            fs.unlinkSync(cacheFile);
            cleaned++;
          }
        } catch (e) {
          // 无效缓存文件，删除
          fs.unlinkSync(cacheFile);
          cleaned++;
        }
      }
    }
    return cleaned;
  }

  /**
   * 压缩图片（超过限制时）
   * 依赖系统工具：sips (macOS) / convert (Linux)
   */
  async compress(filePath, maxSize = MAX_SIZE) {
    const stat = fs.statSync(filePath);
    if (stat.size <= maxSize) return filePath;

    const ext = path.extname(filePath).slice(1).toLowerCase();
    const output = filePath.replace(`.${ext}`, `.compressed.${ext}`);

    if (process.platform === 'darwin') {
      // macOS: 使用 sips
      const quality = Math.max(70, Math.round((maxSize / stat.size) * 100));
      require('child_process').execSync(
        `sips -s format ${ext === 'jpg' ? 'jpeg' : ext} --resampleWidth 1920 --format ${ext === 'jpg' ? 'jpeg' : ext} "${filePath}" --out "${output}"`,
        { stdio: 'ignore' }
      );
    } else {
      // Linux: 使用 convert (ImageMagick)
      require('child_process').execSync(
        `convert "${filePath}" -resize 1920x1920\> -quality 80 "${output}"`,
        { stdio: 'ignore' }
      );
    }

    return output;
  }

  getMimeType(ext) {
    const map = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
    };
    return map[ext] || 'application/octet-stream';
  }

  extFromUrl(url) {
    const match = url.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i);
    return match ? match[1].toLowerCase() : 'jpg';
  }
}

module.exports = ImageHandler;
