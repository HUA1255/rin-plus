# rin-plus

基于 [Rin](https://github.com/openRin/Rin) 的个人博客系统，跑在 Cloudflare Workers + D1 + R2 上。在 Rin 的基础上加强了安全性，改版了首页，并附带把 Obsidian / 语雀文章发布到博客的命令行工具。

A personal blog based on [Rin](https://github.com/openRin/Rin) (Cloudflare Workers + D1 + R2), with security hardening, a redesigned homepage, and CLI tools that publish Obsidian / Yuque notes to the blog.

**在线示例：<https://blog.yafenglink.link>**

## 与 Rin 的关系

- 本项目从 Rin 的 [`308a542`](https://github.com/openRin/Rin/commit/308a542df6165bbf757fad111d7f8ab6296db771)（2026-08-31，v0.3.0）开始修改。它是独立仓库，不是 GitHub fork，也不会自动同步上游更新。
- Rin 由 [Xeu](https://github.com/OXeu) 和社区贡献者开发，采用 MIT 许可证。原版功能和部署方式请看 Rin 的 [README](https://github.com/openRin/Rin#readme) 和 [文档](https://docs.openrin.org)。
- 下面只列出相对 Rin 的改动。

## 改进点

### 安全加固

- **密码存储**：管理员密码改为加盐 HMAC-SHA256。旧的无盐 SHA-256 哈希在下次登录成功后自动升级。
- **登录与评论限流**：按客户端限制登录尝试和评论提交频率（评论默认 10 分钟 8 条）。
- **评论审核**：游客评论默认进入待审核，管理员通过后才公开；访客看不到别人的邮箱；游客填写的网址只接受 http/https。
- **CORS 收紧**：上游对任意来源放行带凭据的跨域请求；这里只放行 `FRONTEND_URL` 配置的地址，同源部署不受影响。
- **安全响应头**：所有响应统一加上 CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`。
- **上传限制**：只接受 png / jpeg / gif / webp / avif，单个文件不超过 5 MB。
- **Markdown 清理**：去掉脚本类标签和 `javascript:` 等危险链接。
- **RSS 开关**：`RSS_ENABLE=false` 时 `/rss.xml`、`/feed.xml` 返回 404，定时任务也不再生成。

### 首页改版

- 首页顶部新增个人名片：显示名称、副名称和社交链接（小红书、B 站、GitHub、邮箱、微信二维码），在后台“设置”里填写，留空就不显示。
- 置顶文章可以排序：后台可上移、下移、取消置顶；首页按顺序展示置顶区，普通列表里不再重复出现置顶文章。
- 新增接口：`GET /feed/pinned`、`POST /feed/pinned/order`、`GET /feed?pinned=exclude`。

### 其他

- **编辑器**：Monaco 编辑器改为随站点打包、同源加载，不再依赖外部 CDN，开启 CSP 后也能正常使用。
- **AI 摘要**：支持 [OpenCode Go](https://opencode.ai) 作为摘要服务。
- **部署工作流**：GitHub Actions 的 Deploy 改为只能手动触发，避免合并代码时自动部署到生产环境。

### 发布工具（`tools/`）

在本地写文章，用命令行发布到博客。每次都先生成本地预览，确认后才写入博客；重复发布会更新原文章而不是新建；图片自动上传到 R2。

| 工具 | 用途 | 文档 |
|---|---|---|
| `obsidian-publish` | 读取本地 Obsidian 库，转换 `![[图片]]`、`[[双链]]`、Callout、高亮等语法后发布 | [README](tools/obsidian-publish/README.md) |
| `yuque-publish` | 拉取语雀文档，处理防盗链图片和颜色标签后发布 | [README](tools/yuque-publish/README.md) |

```bash
export RIN_SITE=https://blog.example.com   # 你的博客地址
bun run obsidian doctor                     # 检查环境
bun run obsidian check   <笔记名>           # 生成预览
bun run obsidian publish <笔记名> --yes     # 发布
```

这两个工具目前依赖 macOS：用 `sips` 转换图片，默认从钥匙串读取管理员账号（也可以用环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD`）。

## 用 AI Agent 部署（推荐）

把下面这段话复制给 Claude Code、Codex、Cursor 等能执行命令的编程 Agent，它会一步步带你部署到自己的 Cloudflare 账号。全程不需要把密钥发给 Agent：密钥由你自己填进本地的 `.env.deploy` 文件。

```text
请帮我部署这个博客：https://github.com/HUA1255/rin-plus
1. 把仓库克隆到当前目录（已经克隆过就直接进入）。
2. 阅读并严格按照 docs/AGENT_DEPLOY.md 的步骤执行。
3. 不要让我在对话里发送任何密钥；需要密钥时，让我自己填写 .env.deploy。
4. 正式部署前先问我确认，结束后告诉我博客地址和后台登录方式。
```

需要准备：一个 Cloudflare 账号（免费版即可），以及本机安装好的 [Bun](https://bun.sh) 和 Git。具体步骤见 [docs/AGENT_DEPLOY.md](docs/AGENT_DEPLOY.md)，也可以照着手动操作。

## 手动部署与本地开发

部署流程与 Rin 相同，参考 [Rin 文档](https://docs.openrin.org) 或 [docs/AGENT_DEPLOY.md](docs/AGENT_DEPLOY.md)。

```bash
git clone https://github.com/HUA1255/rin-plus.git && cd rin-plus
bun install
cp .env.example .env.local   # 按注释填写
bun run dev                  # 本地开发，默认 http://localhost:11498
```

与 Rin 不同的配置：

| 变量 | 说明 |
|---|---|
| `FRONTEND_URL` | 站点公开地址。前端和 Worker 不同源时必须设置，否则跨域请求会被拒绝 |
| `RSS_ENABLE` | 设为 `false` 关闭 RSS |
| `RIN_SITE` | 发布工具要写入的博客地址，默认 `http://localhost:11498` |

## 已知限制

- 后台还没有审核评论的界面。游客评论默认待审，目前需要管理员调用 `PATCH /api/comment/:id`（请求体 `{"approved": true}`）来通过。
- 发布工具只在 macOS 上测试过。

## 反馈与贡献

欢迎提 [Issue](https://github.com/HUA1255/rin-plus/issues)：bug、使用问题、功能建议都可以，也欢迎直接提 Pull Request。

如果问题出在 Rin 本身，建议同时提到 [Rin 上游](https://github.com/openRin/Rin/issues)。

## 许可证

[MIT](LICENSE)。保留 Rin 原作者的版权声明，本仓库的修改部分同样以 MIT 发布。
