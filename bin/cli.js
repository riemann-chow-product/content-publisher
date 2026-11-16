#!/usr/bin/env node
/**
 * content-publisher CLI 入口
 */
'use strict';

const { program } = require('commander');
const pkg = require('../package.json');

// 引入命令
const publishCmd = require('../src/commands/publish');
const configCmd = require('../src/commands/config');
const templateCmd = require('../src/commands/template');
const uploadCmd = require('../src/commands/upload');
const accountCmd = require('../src/commands/account');
const generateCmd = require('../src/commands/generate');

// 版本检查
program.version(pkg.version, '-v, --version', '显示版本号');

// 全局选项
program.option('-d, --debug', '开启调试模式');
program.option('-q, --quiet', '静默模式，减少输出');
program.option('-o, --output <type>', '输出格式: text | json', 'text');

// 全局前置钩子：调试模式
program.on('option:debug', () => {
  process.env.DEBUG = '1';
});

program.on('option:quiet', () => {
  process.env.QUIET = '1';
});

// 注册子命令
program.addCommand(publishCmd);
program.addCommand(configCmd);
program.addCommand(templateCmd);
program.addCommand(uploadCmd);
program.addCommand(accountCmd);
program.addCommand(generateCmd);

// 欢迎信息
program.on('command:*', () => {
  const validCommands = program.commands.map(c => c.name());
  console.error(`未知命令: ${program.args.join(' ')}`);
  console.error(`可用命令: ${validCommands.join(', ')}`);
  process.exit(1);
});

// 无命令时显示帮助
if (process.argv.length === 2) {
  program.parse(['node', 'content-publisher', '--help']);
} else {
  program.parse(process.argv);
}
