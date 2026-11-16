/**
 * 微信公众号平台适配器
 */
'use strict';

const BasePlatform = require('./base');
const ImageHandler = require('../lib/image');
const path = require('path');
const crypto = require('crypto');

class WechatPlatform extends BasePlatform {
  get name() { return '微信公众号'; }
  get id() { return 'wechat'; }

  constructor({ config, logger }) {
    super({ config, logger });
    this.apiBase = 'https://api.weixin.qq.com/cgi-bin';
    this.imageHandler = new ImageHandler();
  }

  /** 获取 access_token */
  async getAccessToken() {
    const appid = this.config.get('wechat.appid');
    const appsecret = this.config.get('wechat.appsecret');

    if (!appid || !appsecret) {
      throw new Error('微信公众号凭证未配置。请运行: content-publisher config set wechat.appid <APPID>');
    }

    // 缓存 token（微信 token 有效期 2 小时）
    const cacheKey = `wechat_access_token_${appid}`;
    const cached = this.config.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.token;
    }

    const url = `${this.apiBase}/token?grant_type=client_credential&appid=${appid}&secret=${appsecret}`;
    const { status, data } = await this.request(url);

    if (status !== 200 || data.errcode) {
      throw new Error(`获取 access_token 失败: ${data.errmsg || data.errcode}`);
    }

    // 缓存，提前 5 分钟过期
    const tokenData = {
      token: data.access_token,
      expires: Date.now() + (data.expires_in - 300) * 1000,
    };
    this.config.set(cacheKey, tokenData);

    return data.access_token;
  }

  /** 验证凭证 */
  async verify() {
    try {
      const token = await this.getAccessToken();
      return { valid: true, message: '凭证有效' };
    } catch (err) {
      return { valid: false, message: err.message };
    }
  }

  /**
   * 上传图片到微信素材库，返回 CDN URL
   * 微信永久素材接口，支持 JPG/PNG，大小不超过 2MB
   */
  async uploadImage(file, baseDir) {
    const token = await this.getAccessToken();
    const img = await this.imageHandler.load(file, baseDir || process.cwd());

    // 检查缓存
    const cached = this.imageHandler.getCache(img.md5, 'wechat');
    if (cached) return { url: cached };

    // 微信上传接口
    const formData = new FormData();
    const blob = new Blob([img.buffer], { type: img.mimeType });
    formData.append('media', blob, path.basename(file));

    const url = `${this.apiBase}/material/add_material?access_token=${token}&type=image`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });
    const data = await response.json();

    if (data.errcode) {
      throw new Error(`图片上传失败: ${data.errmsg} (${data.errcode})`);
    }

    const cdnUrl = data.url || data.media_url;
    this.imageHandler.setCache(img.md5, 'wechat', cdnUrl);

    return { url: cdnUrl, mediaId: data.media_id };
  }

  /**
   * 上传封面图（thumb）到微信素材库
   * 微信要求：不大于2MB，支持bmp/png/jpeg/jpg/gif，封面必须用 type=thumb
   */
  async uploadThumb(file) {
    const token = await this.getAccessToken();
    const img = await this.imageHandler.load(file, process.cwd());

    if (img.size > 2 * 1024 * 1024) {
      throw new Error(`封面图片超过 2MB，当前: ${(img.size / 1024 / 1024).toFixed(2)}MB`);
    }

    const formData = new FormData();
    const blob = new Blob([img.buffer], { type: img.mimeType });
    formData.append('media', blob, path.basename(file));

    const url = `${this.apiBase}/material/add_material?access_token=${token}&type=thumb`;
    const response = await fetch(url, { method: 'POST', body: formData });
    const data = await response.json();

    if (data.errcode) {
      throw new Error(`封面上传失败: ${data.errmsg} (${data.errcode})`);
    }

    return { mediaId: data.media_id };
  }

  /**
   * 发布文章到微信公众号
   * 使用草稿箱接口（draft），返回草稿链接
   */
  async publish(article) {
    const { title, content, cover, draft = true, tags, meta } = article;
    const token = await this.getAccessToken();

    // 1. 上传封面图（thumb 类型，微信要求必须）
    let thumbMediaId = '';
    let coverUrl = cover || '';
    if (cover) {
      try {
        const thumbResult = await this.uploadThumb(cover);
        thumbMediaId = thumbResult.mediaId;
        // thumb 上传不返回 url，coverUrl 保持原路径
      } catch (e) {
        this.logger.warn(`封面上传失败: ${e.message}，将尝试正文图片作为封面`);
        // 降级：使用第一张正文图片作为封面 media_id
        const firstImgMatch = content.match(/<img[^>]+src="([^"]+)"/);
        if (firstImgMatch) {
          try {
            const fallbackResult = await this.uploadThumb(firstImgMatch[1]);
            thumbMediaId = fallbackResult.mediaId;
          } catch (e2) {
            this.logger.warn(`降级封面上传也失败，文章将没有封面`);
          }
        }
      }
    }
    if (!thumbMediaId) {
      // tech-deep 模板兜底：自动用 auto-cover.png
      const autoCover = require('path').join(article.baseDir || process.cwd(), 'auto-cover.png');
      if (require('fs').existsSync(autoCover)) {
        try {
          const fallbackResult = await this.uploadThumb(autoCover);
          thumbMediaId = fallbackResult.mediaId;
          this.logger.info(`ℹ️ 未指定封面，使用自动生成封面: auto-cover.png`);
        } catch (e) {
          this.logger.warn(`自动封面上传失败: ${e.message}`);
        }
      }
    }
    if (!thumbMediaId) {
      throw new Error('发布微信公众号文章必须提供封面图（thumb_media_id），请使用 --cover 指定封面图片');
    }

    // 2. 处理正文中的图片（替换为 CDN URL）
    let processedContent = content;
    const baseDir = article.baseDir || process.cwd();
    if (content.includes('<img')) {
      this.logger.debug('发现正文图片，开始替换...');
      // 简单处理：提取所有本地图片路径并上传
      const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
      let match;
      while ((match = imgRegex.exec(content)) !== null) {
        const src = match[1];
        if (!src.startsWith('http')) {
          try {
            const result = await this.uploadImage(src, baseDir);
            processedContent = processedContent.replace(src, result.url);
          } catch (e) {
            this.logger.warn(`图片上传失败: ${src}，保留原路径`);
          }
        }
      }
    }

    // 3. 构建文章结构
    const author = article.author || this.config.get('wechat.default-author') || meta?.author || '';
    const digest = article.digest || meta?.description || '';
    const collection = article.collection || this.config.get('wechat.default-collection') || meta?.collection || '';

    const articleData = {
      title,
      author,
      digest,
      content: processedContent,
      content_source_url: article.sourceUrl || '',
      thumb_media_id: thumbMediaId,
      need_open_comment: 1,  // tech-deep 默认开启留言
      only_fans_can_comment: 0,
      // 合集字段（微信草稿接口不支持，需在后台手动归类）
      _collection: collection,
    };

    // 4. 发布到草稿箱
    const url = `${this.apiBase}/draft/add?access_token=${token}`;
    const payload = {
      articles: [articleData],
    };

    const { status, data } = await this.request(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (data.errcode) {
      throw new Error(`发布失败: ${data.errmsg} (${data.errcode})`);
    }

    // 草稿箱没有直接 URL，返回 media_id
    return {
      mediaId: data.media_id,
      draft: true,
      author,
      collection,
      message: `草稿已保存。请在后台：①标记「原创」②按需归类合集③检查留言功能后再发布`,
      previewUrl: `https://mp.weixin.qq.com/cgi-bin/draft?action=preview&media_id=${data.media_id}`,
    };
  }

  /** 发布图文消息（图集） */
  async publishNewspic({ title, images, caption, draft = true }) {
    const token = await this.getAccessToken();
    const uploadedImages = [];

    for (const img of images) {
      const result = await this.uploadImage(img);
      uploadedImages.push(result.url);
    }

    const url = `${this.apiBase}/media/news?access_token=${token}`;
    const payload = {
      articles: [{
        title,
        author: this.config.get('wechat.default-author') || '',
        digest: caption || '',
        content: `<p>${uploadedImages.map(url => `<img src="${url}" />`).join('')}</p>`,
        thumb_media_id: '',
        need_open_comment: 0,
        only_fans_can_comment: 0,
      }],
    };

    const { data } = await this.request(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (data.errcode) {
      throw new Error(`图文发布失败: ${data.errmsg}`);
    }

    return { mediaId: data.media_id, draft: true };
  }

  /** 列出模板 */
  async listTemplates() {
    return [
      { id: 'default', name: '默认模板', description: '标准图文模板，适合大多数文章类型' },
      { id: 'cover', name: '封面图模式', description: '大封面图，标题覆盖在封面上，适合资讯类' },
      { id: 'rich', name: '富媒体模板', description: '支持多图、文内卡片，适合深度内容' },
      { id: 'tech-deep', name: '深度技术解析', description: '架构原理/源码分析/系统设计；适合长篇技术解析' },
      { id: 'tutorial', name: '教程实战', description: '适合步骤演示 / 环境搭建 / 代码实操类文章' },
      { id: 'news', name: '资讯快讯', description: '适合产品发布 / 版本更新 / 行业动态类文章' },
      { id: 'opinion', name: '观点评论', description: '适合技术热点 / 趋势分析 / 个人洞察类文章' },
      { id: 'case-study', name: '案例实践', description: '适合项目复盘 / 踩坑记录 / 解决方案类文章' },
      { id: 'tech-essay', name: '科技锐评', description: '科技行业深度随笔/评论，个人视角切入，叙事感强，适合行业观察、职场反思、现象批判类文章' },
    ];
  }

  /** 获取模板写作规范 */
  async getTemplatePrompt(templateId) {
    const prompts = {
      default: `# 微信公众号 — 默认模板写作规范

## 标题
- 建议 14~30 字，避免过于标题党
- 可加 emoji 增加吸引力

## 开头规范（可选）
文章开头可按需放置关注引导图（可选，素材由使用者自备）：

\\\\markdown
![关注引导图](your-banner.png)
\\\\

- 图片文件：由使用者自行提供并配置（本仓库不附带）
- 此 banner 位于文章最顶部，正文内容在 banner 之后

## 正文结构
1. **开篇**：用痛点或数据引入，吸引读者
2. **正文**：小标题（##）分段，每段 100-200 字
3. **结尾**：总结 + 互动引导（"你怎么看？""评论区见"）

## 末尾规范（可选）
文章末尾可按需包含以下结尾（可选，素材由使用者自备），使用居中格式：

\\\\markdown
<!-- center -->— 完 —<!-- /center -->

![二维码](your-qr.png)

<!-- center -->欢迎关注与交流。<!-- /center -->
\\\\

- 分隔符「— 完 —」必须居中（用 <!-- center --> 包裹）
- 二维码图片居中显示
- 引导语必须居中
- 二维码图片文件：由使用者自行提供并配置（本仓库不附带）

## 配图
- 每 300-500 字配一张图
- 图片尺寸建议 900×500 或 1080×600
- 图片自动上传到微信 CDN

## 格式
- 加粗用 **文字**
- 引用用 > 引用文字
- 代码用 \`code\`

## 字数
- 建议 1500~3000 字为佳
- 最多不超过 20000 字`,

      cover: `# 微信公众号 — 封面图模式写作规范

## 封面图（最重要！）
- 封面图是第一眼，需精心设计
- 建议尺寸：900×500 px，16:9
- 标题文字可覆盖在封面图上

## 标题
- 短小精悍，8~20 字
- 强吸引力，可用疑问句或数字

## 正文
- 简洁有力，每段不超过 3 行
- 适合资讯、热点、清单类内容`,

      rich: `# 微信公众号 — 富媒体模板写作规范

## 结构
1. 引言（设置悬念）
2. 核心内容（用多级标题组织）
3. 小结（强化记忆）
4. 互动（引导评论转发）

## 图片使用
- 建议图内嵌方式（非封面图）
- 每段结束后插入图片
- 支持多图并排（用 HTML 方式）`,

      'tech-deep': `# 微信公众号 — 深度技术解析模板

## 平台规范（强制，请严格遵守）

### 作者 & 合集
- **默认作者**：留空则取文章 front-matter 或 wechat.default-author 配置
- **默认合集**：留空则由 wechat.default-collection 配置指定
- 不需要手动指定，发布系统会自动应用

### 文章属性
- **留言功能**：默认开启（need_open_comment=1）
- **原创标识**：需在公众号后台手动标记（API 不支持）
- **合集归类**：需在公众号后台手动添加（API 不支持）

### 封面图
- 必须提供封面图（系统兜底：优先用文章正文第一张图片，若无则自动生成一张架构风格高清封面）
- 封面尺寸：900×500 px，16:9
- 风格：架构图 / 技术示意图 / 深色背景 + 技术关键词

### 开头规范（可选）
文章开头可按需放置关注引导图（可选，素材由使用者自备）：

\\\\markdown
![关注引导图](your-banner.png)
\\\\

- 图片文件：由使用者自行提供并配置（本仓库不附带）
- 此 banner 位于文章最顶部，正文内容在 banner 之后

### 末尾规范（可选）
文章末尾可按需包含以下结尾（可选，素材由使用者自备），使用居中格式：

\\\\markdown
<!-- center -->— 完 —<!-- /center -->

![二维码](your-qr.png)

<!-- center -->欢迎关注与交流。<!-- /center -->
\\\\

- 分隔符「— 完 —」必须居中（用 <!-- center --> 包裹）
- 二维码图片居中显示
- 引导语必须居中
- 二维码图片文件：由使用者自行提供并配置（本仓库不附带）

## 正文结构（五段式）

### 1. 背景与痛点（200~300字）
- 用一个具体问题或场景切入
- 说明现有方案的局限性
- 引出本文要讨论的技术

### 2. 技术原理（核心部分，800~1500字）
- 用 \`##\` 分小节，每节讲一个子主题
- 结合 ASCII 图表说明数据流和架构
- 穿插代码片段或伪代码辅助理解
- 用引用块标注关键概念定义

### 3. 源码对照（可选，500~800字）
- 标注关键代码片段（用 \`\`\` 代码块）
- 解释核心函数和调用链

### 4. 优缺点与适用场景（200~300字）
- 客观分析技术方案的trade-off
- 明确说明适合和不适合的场景

### 5. 总结与延伸（100~200字）
- 一句话概括核心收获
- 推荐延伸阅读链接
- 引导评论："你用过这个技术吗？评论区见"

## 配图规范
- 每个技术模块配一张架构图或流程图
- 代码块用浅色背景（微信代码高亮）
- 图片总数量不少于 3 张

## 格式要求
- \`##\` 一级标题：加粗 + 适当
- \`###\` 二级标题：用于子模块
- 重要术语用 **加粗** 标注
- 代码块用三个反引号包裹
- 引用块（\`>\`）用于定义和概念说明

## 字数
- 建议 2500~5000 字
- 核心原理部分必须占 50% 以上`,

      tutorial: `# 微信公众号 — 教程实战模板

## 适用场景
环境搭建 / 步骤演示 / 代码实操 / 入门指南类文章

## 标题规范
- 20~35 字，含技术栈关键词
- 推荐格式：\`[零基础] XXX 入门教程 | 5步搞定\` 或 \`XXX 安装配置最全指南\`
- 示例："5分钟搭建 AI 开发环境：Windows/Mac/Linux 全攻略"

## 正文结构（六段式）

### 1. 教程目标（100~150字）
- 开篇明确告诉读者：学完这篇能做出什么
- 列出前置条件（操作系统、基础要求）
- 所需工具清单（用无序列表）

### 2. 环境准备（200~400字）
- 列出需要安装的软件和版本
- 提供官网下载地址
- 可选：用表格对比不同版本

### 3. 核心步骤（主体部分，每步 200~400字）
- 用 \`### 第1步：XXX\` 格式，步骤编号清晰
- 每步包含：做了什么 → 命令/操作 → 预期结果
- 命令用代码块包裹，注释用 # 说明
- 操作截图位置用 \`[图片：描述]\` 占位

### 4. 常见问题 FAQ（300~500字）
- 预判读者容易踩的坑
- 用 \`❓ 问题\` + \`✅ 解决\` 的格式
- 至少 3 个常见问题

### 5. 验证与总结（100~200字）
- 如何验证安装/配置成功
- 一句话总结核心要点
- 提供完整示例代码下载/仓库链接

## 配图规范
- 每个步骤至少一张截图
- 用红色箭头/框标注关键位置
- 命令行内容用黑色背景代码块

## 格式要求
- 步骤之间用分隔线区分
- 重要警告用引用块：\`> ⚠️ 注意：xxx\`
- 代码注释用 # 开头，浅灰色

## 字数
- 建议 2000~4000 字
- 核心步骤部分不少于 60%`,

      news: `# 微信公众号 — 资讯快讯模板

## 适用场景
产品发布 / 版本更新 / 行业动态 / 官方公告类文章

## 标题规范
- 15~30 字，信息密度高
- 推荐格式：\`[产品名] vX.X 正式发布！亮点速览\` 或 \`XX 推出 XXX，一文看懂所有更新\`
- 示例："DeepSeek V4 发布：1.6万亿参数，百万上下文，MIT 开源"

## 正文结构（四段式）

### 1. 一句话新闻（50字内）
- 最核心的信息，1~2 句话概括
- 包含：谁 + 做了什么 + 结果
- 粗体突出关键数字和关键词

### 2. 关键更新（主体，500~1000字）
- 用编号列表列出 3~5 个核心更新
- 每条包含：更新内容 + 意义 + 细节
- 用表格对比新旧版本（可用 Markdown 表格）
- 数据类更新用粗体标注数字

### 3. 技术细节（可选，300~500字）
- 针对开发者关注的 API/SDK 更新
- 代码示例用 \`\`\` 代码块
- 链接到官方文档

### 4. 如何获取/相关链接（100~200字）
- 官方下载地址
- 文档链接
- 更新日志链接
- 引导关注/转发

## 配图规范
- 封面图用产品 Logo + 版本号
- 配一张产品界面截图或架构图
- 更新对比用表格而非长段落

## 格式要求
- 重点信息用 **粗体**
- 数字用中文大写或阿拉伯数字双重标注
- 引用官方公告内容用 \`>\` 引用块
- 代码片段用 \`\`\` 代码块

## 字数
- 建议 800~2000 字
- 快讯类宜短，信息密度高
- 详细解读类可适当增加`,

      opinion: `# 微信公众号 — 观点评论模板

## 适用场景
技术热点 / 趋势分析 / 个人洞察 / 产品评测类文章

## 标题规范
- 15~35 字，有立场，有态度
- 推荐格式：\`为什么我看好/不看好 XXX\`、\`XXX 的本质是 XXX\`
- 示例："为什么 AI 代码助手正在杀死初级程序员的面试价值"
- 避免：中立标题 "AI 代码助手评测" → 改为 "AI 代码助手评测：它到底能不能替代你？"

## 正文结构（五段式）

### 1. 观点亮明（200~300字）
- 开篇直接给出核心观点，不要藏着
- 用数据或事实支撑观点
- 结尾用一句有力的结论性句子

### 2. 论据展开（800~1200字）
- 列出 2~4 个分论点
- 每个分论点：观点 + 案例/数据支撑
- 案例要有具体场景和结果
- 用引用块标注权威数据来源

### 3. 反方思考（300~500字）
- 主动提出反对意见
- 分析反方的合理之处
- 展示思考的全面性（加分项）

### 4. 趋势预判（200~300字）
- 基于以上分析，给出未来判断
- 时间维度：短期/中期/长期
- 条件预设："如果...那么..."

### 5. 行动建议（100~200字）
- 给读者的具体行动建议
- 引导讨论："你怎么看？你所在行业有什么类似现象？"

## 配图规范
- 每 400~600 字配一张图
- 用对比图、数据图表增强说服力
- 可用信息图总结核心观点

## 格式要求
- 观点句用 **加粗** 突出
- 数据用粗体 + 大字号突出
- 反方观点用斜体或引用块区分

## 字数
- 建议 2000~4000 字
- 观点类需要一定篇幅展开论证`,

      'case-study': `# 微信公众号 — 案例实践模板

## 适用场景
项目复盘 / 踩坑记录 / 问题排查 / 解决方案类文章

## 标题规范
- 20~40 字，描述问题 + 结果
- 推荐格式：\`[复盘] XXX 项目踩坑记录：我是如何解决的\` 或 \`记一次 XXX 导致的线上故障\`
- 示例："记一次 P99 延迟暴涨 10 倍的排查：原来是这个配置项在作祟"

## 正文结构（七段式）

### 1. 背景（100~200字）
- 项目/系统简介
- 问题发生前的状态
- 相关技术栈说明

### 2. 问题描述（200~300字）
- 具体现象：时间、地点、影响范围
- 用数据量化问题严重程度
- 附上错误日志（用代码块）

### 3. 排查过程（核心部分，600~1000字）
- 按时间顺序还原排查步骤
- 每步：猜测 → 验证 → 结论
- 用代码块展示关键命令和输出
- 用表格展示排查前后的数据对比

### 4. 根因分析（200~400字）
- 用 5-Why 或鱼骨图方式分析根因
- 说明为什么这个问题不容易被发现
- 标注相关源码位置

### 5. 解决方案（300~500字）
- 短期修复方案（治标）
- 长期改进措施（治本）
- 给出具体配置或代码修改

### 6. 复盘总结（200~300字）
- 这次学到了什么
- 建立了什么机制防止同类问题
- 推广到其他系统的预防建议

### 7. 参考资料（100~200字）
- 相关文档链接
- 类似问题参考链接
- 工具/命令参考

## 配图规范
- 每个排查步骤用截图或终端输出
- 错误日志要完整，不要截取关键部分
- 架构图标注出问题节点位置
- 可用流程图还原排查路径

## 格式要求
- 错误日志用 \`\`\` 代码块，浅灰背景
- 关键配置项用 **加粗**
- 时间节点用引用块：\`> [时间] 发生了什么\`
- 重要警告用：\`> ⚠️ 教训：xxx\`

## 字数
- 建议 2500~5000 字
- 排查过程必须详细，还原真实思考路径`,

      'tech-essay': `# 微信公众号 — 科技锐评模板

## 适用场景
科技行业深度随笔 / 职场反思 / 现象批判 / 行业观察 / 读后感类文章。
风格特点：**第一人称叙事 + 犀利观点 + 真实体感**，像写给朋友的长信，不是写论文。

## 标题规范
- 15~30 字，文艺感 + 锐度并存
- 推荐格式：《置身XX》、《XX的真相》、《我在XX的365天》
- 标题要有"想点进去看"的冲动，但不能标题党
- 示例："置身班内：当AI提效变成了AI内卷"

## 平台规范（强制，请严格遵守）

### 作者 & 合集
- **默认作者**：留空则取文章 front-matter 或 wechat.default-author 配置
- **默认合集**：留空则由 wechat.default-collection 配置指定

### 封面图（必须执行）
- 文章最顶部必须放封面图：\`![封面图](xxx-cover.png)\`
- 封面图在关注引导图之前
- 封面尺寸：900×500 px，16:9

### 开头规范（可选）
文章开头可按需包含以下内容（可选）：

\\\\markdown
![封面图](xxx-cover.png)

![关注引导图](your-banner.png)

---

（可选：在此写一段作者自我介绍）

今天聊XXX（一句话引出本文主题）。

---
\\\\

- 封面图 → 关注引导图 → 分隔线 → 自我介绍（可选）→ 主题引入 → 分隔线 → 正文
- 自我介绍段可选，由使用者按自身品牌自行撰写
- 主题引入要自然过渡到正文，一句话即可

### 末尾规范（可选）
文章末尾可按需包含以下结尾（可选，素材由使用者自备），使用居中格式：

\\\\markdown
<!-- center -->— 完 —<!-- /center -->

![二维码](your-qr.png)

<!-- center -->欢迎关注与交流。<!-- /center -->
\\\\

## 正文结构（散文式四幕结构）

### 第一幕：引子（300~500字）
- 用一个**具体的个人经历或场景**开场，把读者拉进来
- 交代写这篇文章的契机（比如读了某篇文章、经历了某件事）
- 语气要真诚，像跟朋友聊天，不要端着
- 结尾抛出核心问题，制造悬念

### 第二幕：现象剖析（800~1500字）
- 把你观察到的现象**一个一个拆开讲**
- 每个现象用 \`##\` 小标题分段，标题要有态度（不要用"现象一"这种）
- 每个现象包含：具体场景描述 + 你的体感 + 为什么这是个问题
- 用**加粗**突出金句和核心观点
- 穿插数据、案例、对比来增强说服力
- 可以用引用块 \`>\` 来插入别人的观点或段子，形成对话感

### 第三幕：深层思考（500~800字）
- 从现象上升到本质：这些问题的根源是什么？
- 提出你的独到见解，要有"一针见血"的感觉
- 可以引用书籍、文章、名人观点来佐证
- 但不要变成说教，保持"我也在思考"的姿态

### 第四幕：收束（200~400字）
- 不要强行给答案，可以留白
- 表达你的态度和立场
- 用一句有力的结尾句收束全文
- 引导讨论："你的公司也是这样吗？评论区聊聊"

## 写作风格要求
- **第一人称**贯穿全文，"我"的视角讲"我们"的故事
- **口语化但不粗糙**：像TED演讲的语言，不是朋友圈吐槽
- **金句密度**：每500字至少一句值得划线的话
- **节奏感**：长短句交替，段落有呼吸感，关键句单独成段
- **真实感**：可以暴露脆弱和困惑，不必全知全能
- **克制**：不要上升到"这个时代完蛋了"的高度，保持冷静观察者的姿态

## 配图规范
- 每 500~800 字配一张图
- 图片风格：插画风 / 信息图 / 场景图，避免纯文字截图
- 可用对比图、流程图来辅助说明观点
- 图片总数量 3~6 张

## 格式要求
- \`##\` 用于主要段落标题，标题要有态度和情绪
- \`###\` 用于段内小节
- 重要观点用 **加粗** 突出
- 引用块用于他人观点、段子、数据引用
- 适当使用分隔线 \`---\` 来分隔不同情绪段落
- 关键转折处可以用单独一行的短句制造停顿感

## 字数
- 建议 2500~4500 字
- 节奏比字数重要，宁可精炼也不要注水`,
    };

    return prompts[templateId] || prompts.default;
  }
}

module.exports = WechatPlatform;
