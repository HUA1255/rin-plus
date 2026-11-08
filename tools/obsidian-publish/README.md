# obsidian-publish：Obsidian → 博客

把 Obsidian 笔记发布到 Rin 博客（站点由 `RIN_SITE` 指定，例如 `RIN_SITE=https://blog.example.com`）。直接读本地 Obsidian 库，不需要先导出。目前依赖 macOS（`sips` 转图、钥匙串读凭据）。

```bash
bun run obsidian doctor                  # 检查 Obsidian 库、sips、博客站点、钥匙串凭据
bun run obsidian list                    # 列出「内容库/文章」下的笔记和是否已发布
bun run obsidian check   DeepSeek        # 转换笔记，生成文章包和 preview.html
bun run obsidian publish DeepSeek        # 只显示计划，不写博客
bun run obsidian publish DeepSeek --yes  # 确认后执行：传图 + 新建/更新文章
bun run obsidian status                  # 笔记 ↔ 博客文章对应关系
```

`<笔记>` 可以是 `.md` 路径、文章文件夹路径，或文章名里的一段文字（先在「内容库/文章」里找，找不到再搜全库；匹配到多篇会列出来让你写具体）。

## 笔记约定

推荐结构：

```
内容库/文章/2026-11-04-文章名/
  index.md
  images/xxx.png | xxx.svg
```

| 来源 | 用途 |
|---|---|
| frontmatter `标题` / `title` | 标题；没有时用正文第一行 `# 标题`（发布时从正文去掉），再没有用文件夹名（去掉日期前缀） |
| `标签` / `tags` | 博客标签，列表或逗号分隔都行，`#` 会去掉 |
| `摘要` / `summary` | 博客摘要（不填由博客自动生成） |
| `别名` / `alias` | 博客文章别名 |
| `发布日期` / `日期` / `date` | 博客显示的发布时间（`创建` 不会被当成发布时间） |
| `状态` | 只做提示：写着「草稿」时 check 会提醒一句，不影响发布 |

博客的草稿 / 公开由命令行决定：默认公开并在首页列出，`--draft` 发草稿，`--unlisted` 不在首页列出。

## 语法转换

| Obsidian | 博客 |
|---|---|
| `![[图.png]]`、`![[图.png\|300]]`、`![](images/图.png)` | 转存到 R2 的图片（`\|300` 变成 `width="300"`） |
| `[[笔记]]`、`[[笔记\|显示文字]]` | 对方已用本工具发布 → 链接到博客文章；否则只保留文字 |
| `![[笔记]]`（嵌入笔记） | 只保留名字，check 会警告 |
| `%%注释%%` | 删除 |
| `==高亮==` | `<mark>` |
| `> [!tip] 标题` Callout | 引用块 + 加粗标题 |
| 行尾块 ID `^abc123` | 删除 |
| 正文中的 `<Agent账号>` 这类非 HTML 尖括号 | 转义，防止被当成标签吞掉 |

代码块和行内代码里的内容一律不动。

## 图片

图片按 Obsidian 的规则找：库内路径 → 相对笔记的路径 → 全库同名文件（离笔记最近的优先）。按文中出现顺序编号复制到文章包 `images/01.png`……

- **SVG 会用 macOS `sips` 渲染成 2 倍尺寸的 PNG**（博客只接受 png/jpg/gif/webp/avif）。
- 超过 5MB 的图压成 JPEG；超过 5MB 的 GIF 报错。
- 找不到的图片会列出来，check 不通过，publish 拒绝执行。外链图片原样保留并提醒。
- 已上传的图按内容哈希记录在 `meta.json`，重复发布不重复上传。

## 文章包与状态

每次 check / publish 都从库里重新生成文章包，**不会改动 Obsidian 库里的任何文件**。默认在 `~/.rin-publish/obsidian/`（可用 `RIN_OBSIDIAN_WORKDIR` 改）：

- `bundles/<文章名>/post.md`、`images/`、`meta.json`、`preview.html`
- `state.json`：笔记路径 → 博客文章 ID。再次发布会**更新**原文章，内容没变就跳过；博客里那篇被删了会新建。

笔记改名或移动后，状态对不上，会被当成新文章；用 `--feed-id <文章ID>` 重新关联即可。以前从语雀发过的文章也用 `--feed-id` 关联后更新。

## 配置与凭据

- Obsidian 库：`OBSIDIAN_VAULT`，默认取 Obsidian 当前打开的库（`~/Library/Application Support/obsidian/obsidian.json`）。
- 文章目录：`OBSIDIAN_ARTICLES_DIR`，默认 `内容库/文章`。
- 博客：`RIN_SITE`，例如 `https://blog.example.com`；不设置时指向本地开发服务器 `http://localhost:11498`。
- 管理员账号只从 macOS 钥匙串读（`RIN_ADMIN_USERNAME` / `RIN_ADMIN_PASSWORD`，account `rin`），不打印、不写文件；也可用同名环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。

## 开发

```bash
bun test tools/obsidian-publish        # 单元测试（临时库 + 假博客，不联网）
cd tools/obsidian-publish && bun run check
```
