# 部署流程（给 AI Agent 执行）

这份文档是写给 Claude Code、Codex、Cursor 等编程 Agent 的操作手册：用户把 README 里的提示词发给 Agent，Agent 按下面的步骤把博客部署到用户自己的 Cloudflare 账号。人也可以照着手动做。

## 规则（Agent 必须遵守）

1. **不要让用户把密钥贴进对话。** Cloudflare 令牌、管理员密码等只写在本地的 `.env.deploy` 文件里，由用户自己填写。
2. **不要打印、记录或提交密钥。** 不要 `cat .env.deploy`，不要把它的内容写进日志、提交信息或其他文件。`.env.*` 已在 `.gitignore` 中。
3. **执行 `bun run deploy` 之前，先向用户确认。** 部署会在 Cloudflare 上创建数据库、队列和 Worker。
4. 每一步失败时，先读报错、对照下方“常见问题”，再告诉用户原因；不要跳过步骤。

## 第 1 步：检查环境

```bash
bun --version        # 需要 Bun 1.1+，没有就提示用户安装：https://bun.sh
git --version
```

然后在仓库根目录安装依赖并确认代码可用：

```bash
bun install
bun run check
```

## 第 2 步：询问用户的部署选项

一次性问清楚下面几项（都不是密钥，可以在对话里回答）：

| 问题 | 写入的变量 | 默认值 |
|---|---|---|
| 博客名称 | `NAME` | `Rin` |
| 博客简介 | `DESCRIPTION` | `A lightweight personal blogging system` |
| 博客访问地址（自定义域名，没有就留空，部署后用 `*.workers.dev`） | `FRONTEND_URL` | 空 |
| 图片存储桶名（R2） | `R2_BUCKET_NAME`、`S3_BUCKET` | `rin-images` |
| 是否开启 RSS | `RSS_ENABLE` | `true` |

## 第 3 步：生成 `.env.deploy`，让用户填写密钥

在仓库根目录创建 `.env.deploy`。非密钥项按第 2 步的回答填好；密钥项留空，并生成一个随机的 `JWT_SECRET`：

```bash
cat > .env.deploy <<EOF
# ---- 需要你填写（不要发给 Agent）----
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
ADMIN_USERNAME=
ADMIN_PASSWORD=

# ---- 已自动生成，请勿泄露 ----
JWT_SECRET=$(openssl rand -hex 32)

# ---- 部署选项 ----
NAME=Rin
DESCRIPTION=A lightweight personal blogging system
FRONTEND_URL=
DB_NAME=rin
WORKER_NAME=rin-server
R2_BUCKET_NAME=rin-images
S3_BUCKET=rin-images
S3_FOLDER=images/
S3_CACHE_FOLDER=cache/
S3_REGION=auto
CACHE_STORAGE_MODE=database
RSS_ENABLE=true
EOF
chmod 600 .env.deploy
```

然后告诉用户：

> 请打开仓库根目录的 `.env.deploy`，填写前 4 项后保存，填好告诉我（不用把内容发给我）：
> - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 控制台首页右侧的“账户 ID”。
> - `CLOUDFLARE_API_TOKEN`：头像 → 我的个人资料 → API 令牌 → 创建令牌，选“编辑 Cloudflare Workers”模板，并额外加上 **D1 编辑**、**Workers R2 存储编辑**、**Queues 编辑** 权限。
> - `ADMIN_USERNAME` / `ADMIN_PASSWORD`：博客后台的登录账号，自己设定。

用户回复后，只检查这几项**是否已填写**，不要输出它们的值：

```bash
set -a; source .env.deploy; set +a
for k in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID ADMIN_USERNAME ADMIN_PASSWORD JWT_SECRET; do
  [ -n "$(printenv "$k")" ] && echo "$k: 已填写" || echo "$k: 缺失"
done
```

## 第 4 步：验证令牌，创建图片存储桶

后面每条命令都在同一个 shell 里执行，或者每次先 `set -a; source .env.deploy; set +a`。

```bash
bunx wrangler whoami                         # 能看到账号即令牌有效
bunx wrangler r2 bucket create "$R2_BUCKET_NAME"   # 已存在会报错，可忽略
```

存储桶会以绑定方式接入 Worker，默认图片经由博客的 `/api/blob/...` 访问，不需要公开存储桶，也不需要额外的 S3 密钥。

（可选）想让图片走独立域名：在 Cloudflare 控制台 R2 → 存储桶 → 设置 → 自定义域，绑定例如 `img.example.com`，然后在 `.env.deploy` 加上 `S3_ACCESS_HOST=https://img.example.com`。

## 第 5 步：部署

**先向用户确认**，再执行：

```bash
set -a; source .env.deploy; set +a
bun run deploy
```

部署脚本会自动：构建前端，创建 D1 数据库和任务队列（已存在则复用），执行数据库迁移，上传密钥到 Worker，部署 Worker。

如果设置了 `FRONTEND_URL`，提示用户在 Cloudflare 控制台：Workers 和 Pages → `rin-server` → 设置 → 域和路由，绑定这个域名。

## 第 6 步：验证

```bash
curl -sI "${FRONTEND_URL:-https://rin-server.<子域>.workers.dev}" | head -1   # 期望 200
```

告诉用户：打开博客地址，右上角登录，用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 进入后台，在“设置”里填写首页名片和社交链接。

## 以后更新

```bash
git pull
bun install
set -a; source .env.deploy; set +a
bun run deploy
```

`JWT_SECRET` 必须保持不变，否则已登录的会话和已升级的管理员密码哈希都会失效。

## 常见问题

| 现象 | 处理 |
|---|---|
| `Authentication error [code: 10000]` | 令牌权限不够，重新创建并加上 D1 / R2 / Queues 编辑权限 |
| `Failed to create D1` | 账号的 D1 数量到上限，或令牌缺 D1 权限 |
| 图片上传失败 | 检查 `R2_BUCKET_NAME` 对应的存储桶是否已创建，名字是否一致 |
| 前端打开后接口跨域报错 | 前端和 Worker 不同源时，`FRONTEND_URL` 必须设成前端的地址，然后重新部署 |
| 在中国大陆网络下 `wrangler` 超时 | 给终端配置代理后重试 |
