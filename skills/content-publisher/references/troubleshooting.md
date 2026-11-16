# 问题排查

## 常见问题

### `command not found: content-publisher`

CLI 未安装或 PATH 问题：

```bash
npm install -g content-publisher
# 如果提示权限错误
sudo npm install -g content-publisher
```

### `微信公众号凭证未配置`

运行交互式配置：

```bash
content-publisher account setup --platform wechat
```

### `access_token 失败` / `凭证验证失败`

1. 检查 AppID 和 AppSecret 是否正确
2. 确保微信公众号已通过认证（未认证账号接口权限受限）
3. Token 可能过期，重新获取：

```bash
content-publisher account setup --platform wechat
```

### `图片上传失败`

可能原因：
- 图片格式不支持（支持：JPG、PNG、GIF、WebP）
- 图片过大（微信永久素材 ≤ 2MB，临时素材 ≤ 10MB）
- 网络超时

解决：
```bash
# 使用缓存跳过已上传图片
content-publisher upload image.jpg --platform wechat --cache

# 强制重新上传
content-publisher upload image.jpg --platform wechat --no-cache
```

### 同一图片重复上传

图片按 MD5 哈希缓存，7 天内不重复上传。清理缓存：

```bash
content-publisher upload image.jpg --platform wechat --clean-cache
```

### `content-publisher config list` 显示空

配置未保存成功，可能原因：
- 目录无写权限：`~/.content-publisher/`
- Node.js 版本过低（需要 >= 18）

### 发布后草稿箱找不到文章

微信公众号草稿箱有时有延迟，刷新 mp.weixin.qq.com 页面。

### 知乎 Token 无效

知乎 Token 有效期约 30 天，过期后需要重新获取：

```bash
content-publisher account setup --platform zhihu
```

## 调试模式

开启调试输出：

```bash
content-publisher --debug publish article.md ...
```

会显示详细的 HTTP 请求和响应。
