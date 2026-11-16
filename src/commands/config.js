/**
 * config 子命令
 */
'use strict';

const { Command } = require('commander');
const Config = require('../lib/config');
const Logger = require('../lib/logger');

const cmd = new Command('config');
const logger = new Logger();

cmd
  .description('查看和修改配置');

cmd
  .command('list')
  .description('列出所有配置')
  .option('--profile <name>', '指定 profile')
  .action(async (opts) => {
    try {
      const config = new Config({ profile: opts.profile });
      const data = config.list();

      // 过滤敏感信息
      const safe = { ...data };
      if (safe['wechat.appsecret']) safe['wechat.appsecret'] = '********';
      if (safe['zhihu.token']) safe['zhihu.token'] = '********';

      logger.info('📋 当前配置:');
      console.log(JSON.stringify(safe, null, 2));
    } catch (err) {
      logger.error(`配置读取失败: ${err.message}`);
      process.exit(1);
    }
  });

cmd
  .command('get')
  .description('获取指定配置项')
  .argument('<key>', '配置键（如 wechat.appid）')
  .action(async (key) => {
    try {
      const config = new Config();
      const val = config.get(key);
      if (val === undefined) {
        logger.warn(`配置项不存在: ${key}`);
      } else {
        // 脱敏
        const sensitive = ['appsecret', 'token', 'password', 'secret'];
        const isSensitive = sensitive.some(s => key.toLowerCase().includes(s));
        console.log(isSensitive && val ? '********' : val);
      }
    } catch (err) {
      logger.error(`读取失败: ${err.message}`);
      process.exit(1);
    }
  });

cmd
  .command('set')
  .description('设置配置项')
  .argument('<key>', '配置键（如 wechat.appid）')
  .argument('<value>', '配置值')
  .option('--profile <name>', '指定 profile')
  .action(async (key, value, opts) => {
    try {
      const config = new Config({ profile: opts.profile });
      config.set(key, value);
      logger.success(`✅ 已设置 ${key}`);
    } catch (err) {
      logger.error(`设置失败: ${err.message}`);
      process.exit(1);
    }
  });

cmd
  .command('delete')
  .description('删除配置项')
  .argument('<key>', '配置键')
  .action(async (key) => {
    try {
      const config = new Config();
      config.delete(key);
      logger.success(`✅ 已删除 ${key}`);
    } catch (err) {
      logger.error(`删除失败: ${err.message}`);
      process.exit(1);
    }
  });

// profile 子子命令
const profileCmd = cmd.command('profile').description('多账号 profile 管理');

profileCmd
  .command('list')
  .description('列出所有 profile')
  .action(() => {
    const config = new Config();
    const profiles = config.listProfiles();
    const active = config.activeProfile;
    logger.info('📋 Profiles:');
    profiles.forEach(p => {
      console.log(`  ${p === active ? '→ ' : '  '}${p}`);
    });
    if (!profiles.includes(active)) {
      console.log(`  → ${active} (当前)`);
    }
  });

profileCmd
  .command('add')
  .description('新建 profile')
  .argument('<name>', 'profile 名称')
  .action((name) => {
    const config = new Config();
    config.addProfile(name);
    logger.success(`✅ 已创建 profile: ${name}`);
  });

profileCmd
  .command('use')
  .description('切换当前 profile')
  .argument('<name>', 'profile 名称')
  .action((name) => {
    const config = new Config();
    config.useProfile(name);
    logger.success(`✅ 已切换到 profile: ${name}`);
  });

profileCmd
  .command('del')
  .description('删除 profile')
  .argument('<name>', 'profile 名称')
  .action((name) => {
    const config = new Config();
    config.deleteProfile(name);
    logger.success(`✅ 已删除 profile: ${name}`);
  });

// verify 子命令
cmd
  .command('verify [platform]')
  .description('验证平台凭证是否有效')
  .action(async (platform) => {
    if (!platform) platform = 'wechat';
    try {
      logger.spin(`正在验证 ${platform} 凭证...`);
      const config = new Config();
      const result = await config.verify(platform);
      if (result.valid) {
        logger.spinSucceed(`✅ ${platform} 凭证有效`);
      } else {
        logger.spinFail(`❌ ${platform} 凭证无效: ${result.message}`);
        process.exit(1);
      }
    } catch (err) {
      logger.spinFail(`验证失败: ${err.message}`);
      process.exit(1);
    }
  });

module.exports = cmd;
