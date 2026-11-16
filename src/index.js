/**
 * content-publisher 主入口
 * 统一导出各平台发布能力
 */
'use strict';

const Config = require('./lib/config');
const Logger = require('./lib/logger');
const MarkdownParser = require('./lib/markdown');
const ImageHandler = require('./lib/image');
const { preprocessLatex } = require('./lib/latex');

// 平台
const WechatPlatform = require('./platforms/wechat');
const ZhihuPlatform = require('./platforms/zhihu');
const WeiboPlatform = require('./platforms/weibo');
const CsdnPlatform = require('./platforms/csdn');
const JuejinPlatform = require('./platforms/juejin');
const JianshuPlatform = require('./platforms/jianshu');
const ToutiaoPlatform = require('./platforms/toutiao');
const YuquePlatform = require('./platforms/yuque');
const Cto51Platform = require('./platforms/51cto');
const SifouPlatform = require('./platforms/sifou');
const OschinaPlatform = require('./platforms/oschina');

const PLATFORMS = {
  wechat: WechatPlatform,
  zhihu: ZhihuPlatform,
  weibo: WeiboPlatform,
  csdn: CsdnPlatform,
  juejin: JuejinPlatform,
  jianshu: JianshuPlatform,
  toutiao: ToutiaoPlatform,
  yuque: YuquePlatform,
  '51cto': Cto51Platform,
  sifou: SifouPlatform,
  oschina: OschinaPlatform,
};

const logger = new Logger();

/**
 * 发布文章到指定平台
 * @param {string} file - Markdown 文件路径
 * @param {Object} options - 发布选项
 * @param {string} options.platform - 平台名称: wechat | zhihu | weibo | all
 * @param {string} options.title - 文章标题
 * @param {string} options.cover - 封面图片路径
 * @param {string} options.template - 模板 ID
 * @param {string} options.draft - 是否发布为草稿
 * @param {string} options.tags - 标签（逗号分隔）
 * @param {string} options.account - 账号 profile
 */
async function publish(file, options = {}) {
  const {
    platform = 'wechat',
    title,
    cover,
    template,
    draft = true,
    tags = '',
    account,
  } = options;

  logger.info(`📖 读取文章: ${file}`);
  const baseDir = require('path').dirname(require('path').resolve(file));
  let content = require('fs').readFileSync(file, 'utf-8');

  // ── LaTeX 预处理：将 $$...$$ 和 $...$ 公式渲染为本地 PNG ──
  try {
    const { content: processed, failed } = await preprocessLatex(content, baseDir);
    content = processed;
    if (failed.length > 0) {
      logger.warn(`⚠️  ${failed.length} 个公式渲染失败，已降级为代码格式显示`);
    }
  } catch (e) {
    logger.warn(`⚠️  LaTeX 预处理跳过: ${e.message}`);
  }
  // ─────────────────────────────────────────────────────────────

  const parsed = MarkdownParser.parse(content);

  const finalTitle = title || parsed.meta.title || require('path').basename(file, '.md');
  const tagList = tags ? tags.split(',').map(t => t.trim()) : parsed.meta.tags || [];

  const results = [];

  const targets = platform === 'all' ? Object.keys(PLATFORMS) : [platform];

  for (const p of targets) {
    const PlatformClass = PLATFORMS[p];
    if (!PlatformClass) {
      logger.warn(`⚠️ 未知平台: ${p}，跳过`);
      continue;
    }

    const config = new Config({ profile: account });
    const instance = new PlatformClass({ config, logger });

    try {
      logger.info(`🚀 开始发布到 ${instance.name}...`);
      const htmlContent = (p === 'wechat') ? MarkdownParser.renderForPlatform(parsed.raw, 'wechat', { theme: template }) : parsed.html;

      const result = await instance.publish({
        title: finalTitle,
        content: htmlContent,
        cover,
        template,
        draft,
        tags: tagList,
        meta: parsed.meta,
        baseDir,
        sourceFile: file,
      });
      results.push({ platform: p, success: true, data: result });
      logger.success(`✅ ${instance.name}: 发布${draft ? '草稿' : '成功'}`);
    } catch (err) {
      results.push({ platform: p, success: false, error: err.message });
      logger.error(`❌ ${instance.name}: ${err.message}`);
    }
  }

  return results;
}

/**
 * 上传图片到指定平台
 * @param {string} file - 图片路径
 * @param {string} platform - 平台名称
 * @param {Object} options - 选项
 */
async function uploadImage(file, platform = 'wechat', options = {}) {
  const PlatformClass = PLATFORMS[platform];
  if (!PlatformClass) throw new Error(`不支持的平台: ${platform}`);

  const config = new Config(options);
  const instance = new PlatformClass({ config, logger });
  return instance.uploadImage(file);
}

/**
 * 列出平台模板
 * @param {string} platform - 平台名称
 */
async function listTemplates(platform = 'wechat') {
  const PlatformClass = PLATFORMS[platform];
  if (!PlatformClass) throw new Error(`不支持的平台: ${platform}`);

  const config = new Config();
  const instance = new PlatformClass({ config, logger });
  return instance.listTemplates();
}

/**
 * 获取模板写作规范
 * @param {string} templateId - 模板 ID
 * @param {string} platform - 平台名称
 */
async function getTemplatePrompt(templateId, platform = 'wechat') {
  const PlatformClass = PLATFORMS[platform];
  if (!PlatformClass) throw new Error(`不支持的平台: ${platform}`);

  const config = new Config();
  const instance = new PlatformClass({ config, logger });
  return instance.getTemplatePrompt(templateId);
}

module.exports = {
  publish,
  uploadImage,
  listTemplates,
  getTemplatePrompt,
  PLATFORMS,
};
