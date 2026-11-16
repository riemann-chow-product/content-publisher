# 贡献指南

感谢你愿意为 content-publisher 做贡献。

## 开发环境

需要 Node.js 18+。

```bash
git clone https://github.com/your-username/content-publisher.git
cd content-publisher
npm install
npm link          # 之后可直接运行 content-publisher
npm test
npm run lint
```

部分平台依赖 Playwright 浏览器自动化，首次使用需安装：

```bash
npx playwright install chromium
```

## 提交 PR 前

- `npm test` 与 `npm run lint` 通过。
- 新增平台适配器请放在 `src/platforms/`，继承 `base.js`，并补充对应测试。
- **不要提交任何真实凭证**：`~/.content-publisher/config.json` 位于用户 home 目录，永远不要把它的内容复制进仓库、示例或测试用例。示例值一律使用 `<YOUR_APPID>` 这类占位符。
- 不要提交本地测试产物、截图、二维码、二进制素材；这些已由 `.gitignore` 排除。
- 提交前可用 `npm pack --dry-run` 核对发布包内容。

## 报告问题

在 [Issues](https://github.com/your-username/content-publisher/issues) 中说明平台、Node 版本、复现步骤，并**贴日志前先抹掉 AppSecret / Cookie / Token**。
