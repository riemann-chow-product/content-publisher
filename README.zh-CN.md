# content-publisher

> 写一份 Markdown，发布到多个中文内容平台。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

**中文** · [English (default)](./README.md)

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
git clone https://github.com/riemann-chow-product/content-publisher.git
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

[MIT](./LICENSE) © 2026 riemann-chow-product

贡献请见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 文章内图表（Archify 风格静态图）

微信公众号 / CSDN 只能放静态图片，所以项目内置了一套借鉴
[Archify](https://github.com/tt-a1i/archify) 视觉语言的**静态图渲染器**：
分层泳道（信任边界）、类型化节点卡片、贝塞尔连线、**主路径高亮**、图例、
标题 / 脚注、明暗主题。输出为 **2x 高清 PNG**（默认 2400×1350），手机端缩放后依然锐利。

### 在文章里写图表

````markdown
```diagram fig1.png
{
  "title": "GroveMQ 双层负载均衡",
  "subtitle": "接入层只分发连接，转发层才决定消息投递语义",
  "badge": "ARCHITECTURE",
  "theme": "dark",
  "groups": [
    { "id": "access", "label": "接入层 / L4", "tone": "cyan" },
    { "id": "forward", "label": "转发层", "tone": "violet" }
  ],
  "nodes": [
    { "id": "lb", "label": "L4 Service", "sub": "ClientIP 亲和", "kind": "network", "group": "access" },
    { "id": "n1", "label": "Broker N1", "kind": "service", "group": "forward" },
    { "id": "db", "label": "订阅表", "kind": "db", "group": "forward" }
  ],
  "edges": [
    { "from": "lb", "to": "n1", "label": "CONNECT", "primary": true },
    { "from": "n1", "to": "db", "dashed": true }
  ],
  "footnote": "负载数据 stale 时自动降级为 fan-out"
}
```
````

然后执行：

```bash
content-publisher generate article-images article.md --out-dir ./imgs
```

`diagram` 代码块会被渲染成 `fig1.png` 并**替换成图片引用**（加 `--keep-block` 保留代码块）。
文章里已有的 `![alt](x.png)` 若文件缺失，也会自动生成 Archify 风格概念图或代码截图 ——
不会再出现「一张只写着 alt 文字的卡片」。

### 独立生成

```bash
# spec 可以是 .json 文件、JSON 字符串，或用 - 从 stdin 读
content-publisher generate diagram spec.json --out fig.png
content-publisher generate diagram '{"nodes":[{"id":"a","label":"A"}]}' --out a.png
cat spec.json | content-publisher generate diagram - --style light --out fig-light.png
```

### Spec 字段

| 字段 | 说明 |
| --- | --- |
| `title` / `subtitle` / `badge` / `footnote` | 标题、副标题、右上角类型角标、右下脚注 |
| `theme` | `dark`（默认）/ `light` |
| `layout` | `lanes`（有 groups 时默认，分组泳道）/ `row` / `column` |
| `groups[]` | `{ id, label, tone }`；`tone`: blue/cyan/violet/green/amber/pink/gray |
| `nodes[]` | `{ id, label, sub, kind, group }`；`kind`: client/network/service/db/cache/queue/external |
| `edges[]` | `{ from, to, label, primary, dashed }`；`primary` 走渐变高亮主路径 |
| `legend` | 默认 `true`，按出现的 kind 生成图例 |

### 视觉规范

- 节点左侧 3px 类型色条 + 类型图标，语义色固定（蓝=客户端、青=网络、紫=服务、绿=存储…）
- 分组用虚线泳道框 + 带光晕的组标题，表达信任边界 / 层次
- 主路径连线为 `#58a6ff → #a371f7` 渐变 + 发光 + 箭头；普通连线为高对比实色、可虚线
- 连线在浏览器内测量节点位置后绘制 SVG，布局由 CSS 决定，无需图布局库
- 所有文案走 `escapeHTML`，spec 里的 `</script>` 会被转义，避免注入

模块：`src/lib/diagram.js`（spec → HTML）、`src/lib/generator.js`（`generateDiagram`）、
`src/commands/generate.js`（CLI）。回归测试：`test/diagram.test.js`。

### 渲染校验与自动修复

每张图在截图前会在浏览器内跑一遍 **11 项校验**，任一不通过就自动修复（最多 8 轮），
仍不过则 `generateDiagram` **抛错，不产出坏图**：

| 规则 | 检查内容 | 自动修复 |
| --- | --- | --- |
| `canvasOverflow` | 节点 / 标题 / 图例不越出画布 | 收紧间距、整体缩放 |
| `nodeOverlap` | 节点两两不重叠 | 收紧间距、整体缩放 |
| `textClipped` | 节点文字不被 `ellipsis` 截断 | 逐级降字号、放宽节点宽度 |
| `edgeLength` | 连线长度 ≥ 8px（箭头可见） | 停止压扁间距，改用整体缩放 |
| `canvasRatio` | 内容占 stage ≤ 90% 宽 / 88% 高 | 收紧间距、整体缩放 |
| `labelOverlap` | 连线标签互不重叠 | 网格搜索重定位、降字号 |
| `labelNodeClearance` | 标签不压住节点卡片 | 网格搜索重定位、引线连接 |
| `labelTextClearance` | **标签与所有文字（含泳道标题）距离 ≥ 8px** | 网格搜索重定位 |
| `labelArrowClearance` | **标签与箭头距离 ≥ 12px** | 重定位、必要时外移箭头 |
| `arrowClearance` | **箭头与所有文字距离 ≥ 12px** | 自动加大 `arrowGap` 外移箭头 |
| `arrowRendered` | **每条边都有真实渲染的箭头** | 发光效果走独立底线，绝不给带 marker 的路径挂 filter |

避让集合包含**全部可见文字**：泳道标题（`.lane-label` / `.lane-head`）、主/副标题、角标、
脚注、图例、节点标题与副标题。曾出现「转发层 / Cluster」被垂直边标签 `PublishForward`
压住 848px² 的重叠，就是因为早期只把 `.node` 卡片当障碍。

箭头统一为**标准实心三角**：`markerUnits="userSpaceOnUse"`（固定 12×10px，不随线宽变形）、
`orient="auto"`（沿末端切线指向目标）、`refX=11`（尖端精确落在目标节点边缘）。
垂直边按「两节点 x 中心同列」判定，不再把同泳道上下相邻的边误画成倒拐曲线。

曾出现「一条消息在转发层的决策路径」里 **primary 边箭头集体缺失**：主路径同时挂了
`filter="url(#glow)"` 和 `marker-end`，而水平路径的 `getBBox()` 高度为 0，
`objectBoundingBox` 单位的滤镜区域塌成 0 高，Chromium 连 `marker-end` 一起裁掉
（恰好 2 条 primary 边中招）。现在发光效果由一条**独立底线**承担（挂 filter、无 marker），
带箭头的路径本身不挂任何 filter；`arrowRendered` 规则会拦截任何回退。
滤镜也改成 `filterUnits="userSpaceOnUse"` 固定区域。

又发现**横线几乎看不见、只剩箭头**：主路径 `stroke="url(#primary)"` 的渐变同样用了
`objectBoundingBox`，在高度为 0 的水平线 bbox 上整条不渲染（像素差分 ink=0）；
普通边 1.5px + 半透明也过淡；而 `dx=Math.max(12, …)` 在 15.8px 的短边上造成控制点
交叉回环。现已改为：渐变 `gradientUnits="userSpaceOnUse"` 覆盖 stage 宽度、
普通边用 `edgeStrong` 实色并把线宽提到 2.2 / 3px、控制点随线长收敛、节点间距下限
从 30 提到 38px（线长 15.8 → 22.7px）。箭头配色也改用主题高对比实色，与线衔接自然。

横向流程图内容矮时，还会**自动收紧画布高度**（默认 1200×675 → 可到 1200×360），
避免图缩在画布中间、上下大片留白；收紧后会重新校验，不通过则退回原尺寸。

查看完整报告：

```bash
content-publisher generate diagram spec.json --out fig.png --audit-json
```

报告示例（`window.__DIAGRAM_AUDIT__`，也随 `generateDiagram()` 返回）：

```json
{
  "passed": true,
  "rounds": 5,
  "scale": 0.86,
  "arrowGap": 8,
  "ratios": { "w": 0.84, "h": 0.34 },
  "repairs": ["label-size->14", "flat-gap->38", "scale->0.93", "scale->0.86"],
  "checks": {
    "arrowClearance": { "ok": true, "detail": "0 arrow/text conflicts, min distance=26.4px" },
    "labelTextClearance": { "ok": true, "detail": "0 labels too close to text, min distance=14.2px" },
    "labelArrowClearance": { "ok": true, "detail": "0 labels too close to arrows, min distance=27.5px" }
  }
}
```

`--no-auto-fit` 可关闭画布高度自适应。回归测试见 `test/diagram.test.js`（含压力布局、
箭头距离、像素级箭头 / 横线渲染、坏图拒绝产出等用例）。
