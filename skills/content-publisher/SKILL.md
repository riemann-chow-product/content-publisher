---
name: content-publisher
description: "Content Publisher — 多平台内容发布技能。将 Markdown 文章一键发布到微信公众号、知乎、微博等多个内容平台，自动处理图片上传、模板选择和多账号管理。触发关键词：'发文章'、'发布到'、'多平台'、'content publisher'、'publish to zhihu'、'publish to weibo'。当用户想要将文章发布到微信公众号之外的平台（知乎、微博等），或需要多平台同时发布时，必须使用此技能。"
---

# Content Publisher — 多平台内容发布技能

统一的内容发布工具，支持将 Markdown 文章发布到多个平台。

## 版本检查

**每次会话首次使用时**，检查 CLI 是否安装：

```bash
content-publisher --version
```

如果提示命令不存在，引导安装：

```bash
npm install -g content-publisher
```

## 环境检查

**每次操作前**，先检查配置：

```bash
content-publisher config list
```

如果未配置，跳转到 `references/setup.md` 引导用户完成设置。

## 核心工作流

### 生成新文章 + 发布

用户要求**写一篇新文章**并发布时，先拉取平台模板规范，再写作：

1. **获取模板写作规范**（决定文章结构、风格）：
   ```bash
   content-publisher template prompt <template-id>
   ```
   如果用户未指定模板，默认为 `wechat`。

2. **按照模板规范写作**，文章写完后执行发布命令。

3. **发布文章**：
   ```bash
   content-publisher publish article.md \
     --platform wechat \
     --title "文章标题" \
     --cover cover.jpg \
     --template default
   ```

### 发布已有文章

用户有现成的 Markdown 文件，直接发布：
```bash
content-publisher publish <file> --platform <platform> --title "标题" --cover <image>
```

## 子命令参考

### `content-publisher publish <file>`

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `<file>` | 是 | — | Markdown 文件路径 |
| `--platform` | 是 | — | 平台：`wechat`、`zhihu`、`weibo`、`all` |
| `--title` | 否 | 文件名 | 文章标题 |
| `--cover` | 推荐 | — | 封面图路径（本地或 URL） |
| `--template` | 否 | default | 模板 ID |
| `--tags` | 否 | — | 标签，逗号分隔 |
| `--draft` | 否 | true | 发布为草稿（默认） |
| `--send` | 否 | — | **直接发布**（不可撤回！） |
| `--account` | 否 | — | 指定 profile 账号 |

> ⚠️ **默认发布草稿**。只有用户明确说"立即发布"、"直接发"，才加 `--send`。

### `content-publisher upload <file>`

上传图片到平台素材库，返回 CDN URL：

```bash
content-publisher upload image.jpg --platform wechat
```

选项：
- `--cache`：使用缓存（默认）
- `--no-cache`：强制重新上传
- `--clean-cache`：清理过期缓存

### `content-publisher template`

```bash
content-publisher template list               # 列出可用模板
content-publisher template prompt <id>         # 获取模板写作规范
content-publisher template preview <id>        # 浏览器预览模板样式
```

### `content-publisher config`

```bash
content-publisher config list                   # 查看所有配置
content-publisher config get <key>              # 读取单项配置
content-publisher config set <key> <value>      # 设置配置项
content-publisher config verify [platform]      # 验证凭证有效性
```

### `content-publisher account`

```bash
content-publisher account list                  # 列出所有平台账号
content-publisher account setup --platform wechat  # 交互式引导配置
content-publisher account remove <platform>     # 移除账号
```

### `content-publisher profile`

Profile = 多环境多账号管理（类似 git config --local）：

```bash
content-publisher config profile list            # 列出 profile
content-publisher config profile add dev         # 新建 profile
content-publisher config profile use dev        # 切换到 dev
```

## 多平台发布

同时发布到多个平台：

```bash
content-publisher publish article.md \
  --platform all \
  --title "全平台文章标题" \
  --cover cover.jpg
```

平台会按顺序依次发布（wechat → zhihu → weibo），失败不影响其他平台。

## 错误处理

遇到错误时，先读取 `references/troubleshooting.md` 查找常见问题和解决方案。

常见错误：
- `command not found`：未安装 CLI → `npm install -g content-publisher`
- `微信公众号凭证未配置`：运行 `content-publisher account setup --platform wechat`
- `图片上传失败`：检查图片格式（JPG/PNG/GIF/WebP）和大小（微信 ≤ 2MB）
- `access_token 过期`：重新运行 `account setup` 刷新凭证

## 配置参考

详见 `references/config.md`。
