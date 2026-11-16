# content-publisher

> 写一份 Markdown，发布到多个中文内容平台。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

`content-publisher` 是一个命令行工具：把同一篇 Markdown 文章转换、配图并发布到微信公众号、知乎、微博、CSDN、掘金等平台，省去逐个后台复制粘贴、手动上传图片、反复调格式的重复劳动。

## 特性

- **一次编写，多端发布**：支持微信公众号、知乎、微博、CSDN、掘金、简书、今日头条、语雀、51CTO、SegmentFault、开源中国。
- **图片自动处理**：自动提取文内图片、上传并替换为平台可访问的 URL；支持封面 / 插图生成。
- **凭证本地保存**：配置存放在 `~/.content-publisher/config.json`（用户 home 目录，不进仓库），`config list` 自动打码敏感字段。
- **多账号隔离**：Profile 机制可在多个公众号 / 账号之间切换。
- **模板系统**：内置多种写作模板，可按文章类型选择。
- **无后端、无遥测**：纯本地 CLI，不上传任何内容到第三方服务（除你指定的目标平台）。

## 安装

```bash
npm install -g content-publisher
```

或从源码开发：

```bash
git clone https://github.com/your-username/content-publisher.git
cd content-publisher
npm install
npm link
```

部分平台的发布流程依赖 Playwright，首次使用需安装浏览器：

```bash
npx playwright install chromium
```

## 快速开始

```bash
# 1. 配置凭证（交互式引导，也可直接 set）
content-publisher account setup --platform wechat
content-publisher config set wechat.appid <YOUR_APPID>
content-publisher config set wechat.appsecret <YOUR_APPSECRET>

# 2. 检查配置（敏感值会显示为 ********）
content-publisher config list

# 3. 发布（默认保存到公众号草稿箱，不会直接群发）
content-publisher publish ./article.md --platform wechat

# 查看全部命令
content-publisher --help
```

> 微信公众号通过官方 API 写入**草稿箱**，「原创」标记、合集归类、最终群发仍需在公众号后台完成。

## 命令

| 命令 | 说明 |
| --- | --- |
| `publish` | 发布 Markdown 文章到指定平台 |
| `config` | 查看 / 设置 / 删除配置项，管理 Profile |
| `account` | 交互式配置平台账号凭证 |
| `template` | 列出 / 查看内置写作模板 |
| `upload` | 单独上传图片素材 |
| `generate` | 生成封面图 / 插图 / 文章配图 |

每个子命令都支持 `--help`，例如 `content-publisher publish --help`。

## 支持的平台

| 平台 | 认证方式 | 备注 |
| --- | --- | --- |
| 微信公众号 | AppID + AppSecret（官方 API） | 写入草稿箱 |
| 知乎 | Token / Cookie | |
| 微博 | UID + access_token | |
| CSDN / 掘金 / 简书 / 今日头条 / 51CTO / SegmentFault / 开源中国 | Cookie | 部分平台使用浏览器自动化 |
| 语雀 | Bearer Token | |

各平台适配器位于 `src/platforms/`，新增平台只需继承 `base.js` 并实现对应方法。

## 配置

配置保存在 `~/.content-publisher/config.json`，常用键：

| 键 | 说明 |
| --- | --- |
| `wechat.appid` / `wechat.appsecret` | 微信公众号凭证 |
| `wechat.default-author` | 默认作者（留空则取文章 front-matter） |
| `wechat.default-collection` | 默认合集名 |
| `zhihu.token` / `zhihu.cookies` | 知乎凭证 |
| `weibo.uid` / `weibo.cookies` | 微博凭证 |
| `global.default-platform` | 默认目标平台 |
| `global.default-cover` | 默认封面图路径 |

```bash
content-publisher config set <key> <value>
content-publisher config list
content-publisher account remove <platform>
```

**安全提示**：`config.json` 位于用户 home 目录、不在仓库内，内含真实 AppSecret / Cookie。请勿提交、截图或粘贴它的内容；分享日志前先抹掉凭证。

## 文章格式

标准 Markdown，支持 YAML front-matter 覆盖默认值：

```markdown
---
title: 文章标题
author: 作者名
cover: ./cover.png
platform: wechat
---

## 正文

这里是正文，图片会随发布自动上传。
```

内置模板：`default`、`cover`、`rich`、`tech-deep`、`tutorial`、`news`、`opinion`、`case-study`、`tech-essay`。用 `content-publisher template list` 查看。

> 模板中的关注横幅、二维码等属于**可选的品牌素材**，由使用者自行提供并配置；本仓库不附带任何个人或第三方品牌图片。

## 可选：配合 Agent Skill 使用

仓库中的 `skills/content-publisher/` 提供了供 Claude Code / Codex 等 Agent 使用的技能说明，方便在对话里直接触发发布流程。

如果需要社交卡片 / 封面视觉生成能力，可另行安装第三方技能（与本项目相互独立、许可证各自适用）：

```bash
npx skills add https://github.com/op7418/social-card --skill social-card
```

> 该项目采用 GNU AGPL-3.0，本仓库未捆绑、也未修改其代码；请遵循其自身许可证。

## 开发

```bash
npm test          # node --test test/
npm run lint      # eslint src/
npm pack --dry-run  # 核对将要发布的 tarball 内容
```

## 许可证

[MIT](./LICENSE) © 2026 your-username

贡献请见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
