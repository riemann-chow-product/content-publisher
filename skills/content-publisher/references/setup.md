# 首次配置指南

## 安装 CLI

```bash
npm install -g content-publisher
```

验证安装：

```bash
content-publisher --version
```

## 配置各平台

### 微信公众号

1. 登录 [微信公众平台](https://mp.weixin.qq.com)
2. 获取 AppID 和 AppSecret（开发 → 基本配置）
3. 运行配置命令：

```bash
content-publisher config set wechat.appid <YOUR_APPID>
content-publisher config set wechat.appsecret <YOUR_APPSECRET>
content-publisher config set wechat.default-author "你的名字"
```

4. 验证凭证：

```bash
content-publisher config verify wechat
```

### 知乎

1. 在[知乎开放平台](https://open.zhihu.com)注册应用获取 Token，或通过 OAuth 获取。
2. 配置：

```bash
content-publisher config set zhihu.token <YOUR_TOKEN>
content-publisher config verify zhihu
```

### 微博

1. 在[微博开放平台](https://open.weibo.com)创建应用获取 App Key。
2. 通过 OAuth 获取 access_token。
3. 配置：

```bash
content-publisher config set weibo.access_token <YOUR_TOKEN>
content-publisher config set weibo.uid <YOUR_UID>
content-publisher config verify weibo
```

## 设置默认平台

```bash
content-publisher config set global.default-platform wechat
```

## 快速验证

```bash
content-publisher config list
```

确保所有必要配置项都显示为已设置（非 `-`）。

## 多环境（可选）

生产环境和测试环境使用不同的账号：

```bash
# 新建测试环境
content-publisher config profile add test

# 切换到测试环境
content-publisher config profile use test

# 测试环境配置独立的微信账号
content-publisher config set wechat.appid <TEST_APPID>
content-publisher config set wechat.appsecret <TEST_APPSECRET>

# 切换回生产环境
content-publisher config profile use default
```

发布时临时指定账号：

```bash
content-publisher publish article.md --platform wechat --account test
```
