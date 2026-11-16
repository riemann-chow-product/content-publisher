/**
 * template 子命令
 */
'use strict';

const { Command } = require('commander');
const publisher = require('../index');
const Logger = require('../lib/logger');

const cmd = new Command('template');
const logger = new Logger();

cmd
  .description('模板管理');

cmd
  .command('list')
  .description('列出可用模板')
  .option('-p, --platform <name>', '平台', 'wechat')
  .action(async (opts) => {
    try {
      logger.spin('正在获取模板列表...');
      const templates = await publisher.listTemplates(opts.platform);
      logger.spinSucceed('模板列表:');

      if (Array.isArray(templates) && templates.length > 0) {
        logger.table(
          ['ID', '名称', '描述'],
          templates.map(t => [t.id, t.name, t.description || ''])
        );
      } else {
        logger.info('暂无可用模板');
      }
    } catch (err) {
      logger.spinFail(`获取模板失败: ${err.message}`);
      process.exit(1);
    }
  });

cmd
  .command('prompt')
  .description('获取模板的写作规范（给 AI 写作用）')
  .argument('<template-id>', '模板 ID')
  .option('-p, --platform <name>', '平台', 'wechat')
  .action(async (templateId, opts) => {
    try {
      const prompt = await publisher.getTemplatePrompt(templateId, opts.platform);
      console.log(prompt);
    } catch (err) {
      logger.error(`获取模板失败: ${err.message}`);
      process.exit(1);
    }
  });

cmd
  .command('preview')
  .description('预览模板样式（浏览器打开）')
  .argument('<template-id>', '模板 ID')
  .option('-p, --platform <name>', '平台', 'wechat')
  .action(async (templateId, opts) => {
    try {
      const { default: open } = await import('open');
      logger.spin('正在打开预览...');
      // 这里需要平台实现 preview URL
      logger.spinSucceed('请在浏览器中查看预览效果');
    } catch (err) {
      logger.error(`预览失败: ${err.message}`);
      process.exit(1);
    }
  });

module.exports = cmd;
