/**
 * publish 子命令
 */
'use strict';

const { Command } = require('commander');
const path = require('path');
const publisher = require('../index');
const Logger = require('../lib/logger');

const cmd = new Command('publish');
const logger = new Logger();

cmd
  .description('发布 Markdown 文章到内容平台')
  .argument('<file>', 'Markdown 文件路径')
  .requiredOption('-p, --platform <name>', '平台: wechat | zhihu | weibo | csdn | juejin | jianshu | toutiao | yuque | 51cto | sifou | oschina | all')
  .option('-t, --title <title>', '文章标题（默认从 front-matter 或文件名获取）')
  .option('-c, --cover <path>', '封面图片路径')
  .option('--template <id>', '模板 ID')
  .option('--tags <tags>', '标签（逗号分隔）', '')
  .option('--digest <text>', '文章摘要')
  .option('--source-url <url>', '阅读原文链接')
  .option('--author <name>', '作者名')
  .option('--draft', '发布为草稿（默认 true）', true)
  .option('--send', '直接发布（慎用！发送后无法撤回）')
  .option('--account <name>', '使用的账号 profile')
  .action(async (file, opts) => {
    try {
      // 验证文件
      const fs = require('fs');
      if (!fs.existsSync(file)) {
        // 尝试在当前目录搜索
        const cwdFile = path.join(process.cwd(), file);
        if (fs.existsSync(cwdFile)) {
          file = cwdFile;
        } else {
          logger.error(`文件不存在: ${file}`);
          process.exit(1);
        }
      }

      // 解析路径，获取基准目录（用于解析相对图片路径）
      const baseDir = path.dirname(path.resolve(file));

      const options = {
        platform: opts.platform,
        title: opts.title,
        cover: opts.cover,
        template: opts.template,
        draft: opts.send !== undefined ? !opts.send : true,
        tags: opts.tags,
        account: opts.account,
      };

      if (opts.digest) options.digest = opts.digest;
      if (opts.sourceUrl) options.sourceUrl = opts.sourceUrl;
      if (opts.author) options.author = opts.author;

      logger.spin(`🚀 正在发布到 ${options.platform}...`);

      const results = await publisher.publish(file, options);

      const allSuccess = results.every(r => r.success);
      const allFailed = results.every(r => !r.success);

      if (allSuccess) {
        logger.spinSucceed('🎉 全部发布成功！');
        for (const r of results) {
          if (r.data?.url) {
            logger.info(`   ${r.platform}: ${r.data.url}`);
          } else if (r.data?.draftUrl) {
            logger.info(`   ${r.platform} 草稿: ${r.data.draftUrl}`);
          }
        }
      } else if (allFailed) {
        logger.spinFail('💥 全部发布失败');
        process.exit(1);
      } else {
        logger.spinWarn('部分平台发布失败');
        for (const r of results) {
          if (r.success) {
            logger.success(`✅ ${r.platform}: 成功`);
          } else {
            logger.error(`❌ ${r.platform}: ${r.error}`);
          }
        }
        process.exit(1);
      }
    } catch (err) {
      logger.spinFail(`发布失败: ${err.message}`);
      if (process.env.DEBUG) console.error(err);
      process.exit(1);
    }
  });

module.exports = cmd;
