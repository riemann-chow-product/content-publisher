/**
 * 参数校验工具
 */

/**
 * 校验文件是否存在
 */
function validateFile(filePath) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`不是文件: ${filePath}`);
  }
  return true;
}

/**
 * 校验平台名称
 */
function validatePlatform(platform) {
  const valid = ['wechat', 'zhihu', 'weibo', 'all'];
  if (!valid.includes(platform)) {
    throw new Error(`不支持的平台: ${platform}。支持的平台: ${valid.join(', ')}`);
  }
  return true;
}

/**
 * 校验图片文件
 */
function validateImage(filePath) {
  const fs = require('fs');
  const path = require('path');
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

  if (!validExts.includes(ext)) {
    throw new Error(`不支持的图片格式: .${ext}。支持的格式: ${validExts.join(', ')}`);
  }

  if (fs.existsSync(filePath)) {
    const size = fs.statSync(filePath).size;
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (size > maxSize) {
      throw new Error(`图片过大: ${(size / 1024 / 1024).toFixed(2)}MB（最大 ${maxSize / 1024 / 1024}MB）`);
    }
  }

  return true;
}

/**
 * 校验标题
 */
function validateTitle(title) {
  if (!title || title.trim().length === 0) {
    throw new Error('标题不能为空');
  }
  if (title.length > 100) {
    throw new Error('标题过长（最多 100 字）');
  }
  return true;
}

module.exports = {
  validateFile,
  validatePlatform,
  validateImage,
  validateTitle,
};
