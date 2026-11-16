/**
 * account 子命令
 */
'use strict';

const { Command } = require('commander');
const Config = require('../lib/config');
const Logger = require('../lib/logger');
// inquirer 在 action 中动态导入

const cmd = new Command('account');
const logger = new Logger();

cmd
  .description('多平台账号管理');

cmd
  .command('list')
  .description('列出所有平台账号')
  .action(() => {
    const config = new Config();
    const profiles = config.listProfiles();
    const active = config.activeProfile;

    const platforms = ['wechat', 'zhihu', 'weibo'];

    logger.info('📋 账号概览:');
    logger.table(
      ['平台', 'AppID / UID', '状态'],
      platforms.map(p => {
        const appid = config.get(`${p}.appid`) || config.get(`${p}.uid`);
        const verified = appid ? '✅ 已配置' : '❌ 未配置';
        return [p, appid || '-', verified];
      })
    );

    console.log(`\nProfiles: ${profiles.join(', ') || 'default'}`);
    console.log(`当前: → ${active}`);
  });

cmd
  .command('setup')
  .description('交互式引导配置账号')
  .option('-p, --platform <name>', '指定平台', 'wechat')
  .action(async (opts) => {
    try {
      const inquirer = await import('inquirer').then(m => m.default);
      const config = new Config();
      logger.info(`🔧 开始配置 ${opts.platform} 账号\n`);

      const questions = [];

      if (opts.platform === 'wechat') {
        questions.push(
          {
            type: 'input',
            name: 'appid',
            message: '微信公众号 AppID:',
            validate: v => v.length > 0 || 'AppID 不能为空',
          },
          {
            type: 'password',
            name: 'appsecret',
            message: '微信公众号 AppSecret:',
            mask: '*',
            validate: v => v.length > 0 || 'AppSecret 不能为空',
          }
        );
      } else if (opts.platform === 'zhihu') {
        questions.push(
          {
            type: 'input',
            name: 'token',
            message: '知乎 Access Token (从知乎开放平台获取):',
          }
        );
      } else if (opts.platform === 'weibo') {
        questions.push(
          {
            type: 'input',
            name: 'uid',
            message: '微博 UID:',
          }
        );
      }

      const answers = await inquirer.prompt(questions);

      // 保存
      if (opts.platform === 'wechat') {
        config.set('wechat.appid', answers.appid);
        config.set('wechat.appsecret', answers.appsecret);
      } else {
        config.set(`${opts.platform}.token`, answers.token);
      }

      // 验证
      logger.spin('正在验证凭证...');
      try {
        const result = await config.verify(opts.platform);
        if (result.valid) {
          logger.spinSucceed('✅ 凭证验证通过！');
        } else {
          logger.spinWarn(`⚠️ 凭证验证失败: ${result.message}`);
        }
      } catch (e) {
        logger.spinWarn(`⚠️ 验证出错: ${e.message}，请手动检查`);
      }

      logger.success(`\n✅ ${opts.platform} 配置完成！`);
      logger.info(`运行以下命令查看配置:\n  content-publisher config list`);
    } catch (err) {
      if (err.isTtyError) {
        logger.error('请在交互式终端中使用此命令');
      } else {
        logger.error(`配置失败: ${err.message}`);
      }
      process.exit(1);
    }
  });

cmd
  .command('remove')
  .description('移除指定平台账号')
  .argument('<platform>', '平台名称: wechat | zhihu | weibo')
  .action((platform) => {
    const config = new Config();
    const keys = [`${platform}.appid`, `${platform}.appsecret`, `${platform}.uid`, `${platform}.token`];
    keys.forEach(k => config.delete(k));
    logger.success(`✅ 已移除 ${platform} 账号`);
  });

module.exports = cmd;
