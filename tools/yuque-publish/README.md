# yuque-publish：语雀 → 博客

把语雀文档发布到 Rin 博客（站点由 `RIN_SITE` 指定，例如 `RIN_SITE=https://blog.example.com`）。分三步，每一步的产物都在本地，可以先检查再往下走：

```bash
bun run yuque doctor                                   # 检查语雀 Token、图片 CDN、博客站点、钥匙串凭据
bun run yuque list    https://www.yuque.com/<用户>/<知识库>
bun run yuque fetch   https://www.yuque.com/<用户>/<知识库>/<文档slug>
bun run yuque check   <文档slug>                        # 校验并生成 preview.html
bun run yuque publish <文档slug>                        # 只显示计划，不写博客
bun run yuque publish <文档slug> --yes                  # 确认后执行：传图 + 新建/更新文章
bun run yuque status                                   # 语雀文档 ↔ 博客文章对应关系
```

## 文章包

`fetch` 把一篇文档存成文章包，默认在 `~/.rin-publish/yuque/bundles/<slug>/`（可用 `RIN_YUQUE_WORKDIR` 改）：

| 文件 | 内容 |
|---|---|
| `post.md` | 清洗后的正文，图片已改为 `images/NN.ext` |
| `images/` | 本地图片，按文中出现顺序编号 `01.png`、`02.jpg`…… |
| `meta.json` | 来源文档、标题、标签、别名、每张图的来源和上传结果 |
| `preview.html` | `check` 生成的本地预览，渲染管线与博客一致（GFM + 原始 HTML），支持暗色 |

正文清洗：去掉语雀默认的近黑色 `<font>`（暗色模式下看不清），其它颜色转成 `<span style="color:…">`；正文中不是 HTML 标签的尖括号（如 `<Agent账号>`）会被转义，代码块里的不动。

## 图片

语雀图片（`cdn.nlark.com` 等）有防盗链，必须转存到博客 R2。`fetch` 按以下顺序取图：

1. 文章包里已有同编号的文件；
2. `--images-from <目录>` 里同编号的文件（手动从浏览器保存的图）；
3. 带 `Referer: https://www.yuque.com/` 下载。下载内容会按文件头校验，被防盗链拦截时返回的 HTML 不会被当成图片。

拿不到的图片会列出编号和链接，`check` 不通过，`publish` 拒绝执行，不会发出裂图文章。超过 5MB 的图会用 `sips` 压成 JPEG。重新 `fetch` 时，如果某个编号位置换成了别的图，旧文件会被删掉，避免配错图。

在 Claude Code 沙箱里运行时，`cdn.nlark.com` 需要在沙箱网络白名单中，否则下载会被重置连接；这时可以手动保存图片后用 `--images-from`。

## 发布

- 默认公开发布并在首页列出；`--draft` 发草稿，`--unlisted` 不在首页列出。
- 不加 `--yes` 只登录并显示计划（新建 / 更新 #ID / 内容无变化、要上传几张图），不写博客。
- 对应关系记录在 `~/.rin-publish/yuque/state.json`：同一篇语雀文档再次发布会**更新**原文章，内容没变就跳过；博客里那篇被删了会新建。
- 工具上线前已经手动发过的文章，用 `--feed-id <文章ID>` 关联后更新。
- 已上传的图片记录在 `meta.json`，重复发布不会重复上传；图片内容变了才重传。

## 凭据

只从 macOS 钥匙串读取，不打印、不写文件：语雀 `YUQUE_TOKEN`（account `yuque`），博客 `RIN_ADMIN_USERNAME` / `RIN_ADMIN_PASSWORD`（account `rin`）。测试或其它机器可用同名环境变量。`RIN_SITE` 指定博客地址，不设置时指向本地开发服务器 `http://localhost:11498`。

## 开发

```bash
bun test tools/                      # 单元测试（假语雀、假博客，不联网）
cd tools/yuque-publish && bun run check
```

语雀评论读取不在本工具范围内（官方 Token API 没有评论接口）。
