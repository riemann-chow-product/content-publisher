/**
 * Content Publisher Skill for OpenClaw / Claude Code
 *
 * 多平台内容发布技能，支持微信公众号、知乎、微博等
 */
export default {
  name: "content-publisher",
  version: "1.0.0",
  description: "Content Publisher — 多平台内容发布技能。将 Markdown 文章一键发布到微信公众号、知乎、微博等多个内容平台。触发关键词：'发文章'、'发布到'、'多平台'、'content publisher'。",

  triggers: [
    "content-publisher",
    "content publisher",
    "发文章",
    "发布到",
    "多平台发布",
    "全平台",
    "publish to zhihu",
    "publish to weibo",
    "publish to wechat",
    "wechat article",
    "zhihu article",
    "weibo post",
  ],

  config: {
    promptFile: "SKILL.md",
    hasEvals: false,
    languages: ["zh-CN", "en"],
    dependencies: {
      cli: {
        name: "content-publisher",
        packageManager: "npm",
        package: "content-publisher",
        global: true,
        requiredVersion: ">=1.0.0",
      }
    }
  },

  utils: {
    commands: {
      publish: "content-publisher publish <file> --platform <name> --title <title> --cover <image>",
      upload: "content-publisher upload <file> --platform <name>",
      templateList: "content-publisher template list",
      templatePrompt: "content-publisher template prompt <template-id>",
      configList: "content-publisher config list",
      configSet: "content-publisher config set <key> <value>",
      accountList: "content-publisher account list",
      accountSetup: "content-publisher account setup --platform <name>",
      profileList: "content-publisher config profile list",
      profileUse: "content-publisher config profile use <name>",
    },

    platforms: ["wechat", "zhihu", "weibo", "all"],
  },

  author: {
    name: "content-publisher"
  },

  links: {
    homepage: "https://github.com/content-publisher/content-publisher",
    repository: "https://github.com/content-publisher/content-publisher",
    issues: "https://github.com/content-publisher/content-publisher/issues",
  }
};
