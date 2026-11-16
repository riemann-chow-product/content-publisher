/**
 * upload 子命令
 */
'use strict';

const { Command } = require('commander');
const publisher = require('../index');
const Logger = require('../lib/logger');
const ImageHandler = require('../lib/image');

const cmd = new Command('upload');
const logger = new Logger();

cmd
  .description('上传图片到平台素材库')
  .argument('<file>', '图片文件路径（支持本地路径或 URL）')
  .option('-p, --platform <name>', '平台', 'wechat')
  .option('-c, --cache', '使用缓存（已上传过的图片跳过）', true)
  .option('--no-cache', '禁用缓存，强制重新上传')
  .option('--clean-cache', '清理图片缓存')
  .action(async (file, opts) => {
    try {
      const imageHandler = new ImageHandler();

      // 清理缓存
      if (opts.cleanCache) {
        const n = imageHandler.cleanCache();
        logger.success(`✅ 已清理 ${n} 个过期缓存`);
        return;
      }

      // 加载图片
      logger.spin(`正在加载图片: ${file}`);
      const img = await imageHandler.load(file, process.cwd());
      logger.spinSucceed(`已加载: ${img.size} bytes, ${img.mimeType}`);

      // 检查缓存
      if (opts.cache && !opts.noCache) {
        const cached = imageHandler.getCache(img.md5, opts.platform);
        if (cached) {
          logger.info(`🗂️ 命中缓存（MD5: ${img.md5}）`);
          console.log(cached);
          return;
        }
      }

      // 上传
      logger.spin(`正在上传到 ${opts.platform}...`);
      const result = await publisher.uploadImage(file, opts.platform);

      // 写入缓存
      if (result.url) {
        imageHandler.setCache(img.md5, opts.platform, result.url);
      }

      logger.spinSucceed('上传成功！');
      console.log(result.url);
    } catch (err) {
      logger.spinFail(`上传失败: ${err.message}`);
      process.exit(1);
    }
  });

module.exports = cmd;
