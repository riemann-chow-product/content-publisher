# 配置参考

所有配置存储在 `~/.content-publisher/config.json`。

## 配置命令

```bash
content-publisher config set <key> <value>
content-publisher config get <key>
content-publisher config list
content-publisher config delete <key>
```

## 配置项

### 微信公众号

| 键 | 说明 |
|---|---|
| `wechat.appid` | AppID |
| `wechat.appsecret` | AppSecret |
| `wechat.default-author` | 默认作者名 |
| `wechat.default-template` | 默认模板 ID |

### 知乎

| 键 | 说明 |
|---|---|
| `zhihu.token` | Access Token |
| `zhihu.default-column` | 默认专栏 ID |

### 微博

| 键 | 说明 |
|---|---|
| `weibo.access_token` | OAuth Access Token |
| `weibo.uid` | 用户 UID |

### 全局

| 键 | 说明 |
|---|---|
| `global.default-platform` | 默认平台 |
| `global.default-cover` | 默认封面图路径 |
| `global.editor` | 打开草稿的编辑器 |

## Profile 多环境

```bash
# 新建
content-publisher config profile add <name>

# 切换
content-publisher config profile use <name>

# 删除
content-publisher config profile del <name>

# 列出
content-publisher config profile list
```

Profile 内的配置项：`wechat.*`、`zhihu.*`、`weibo.*`、`global.*`。

临时使用其他 profile（不加 `--profile` 参数的情况下）：

```bash
content-publisher publish article.md --account <profile-name>
```
