#!/usr/bin/env bun
/**
 * Obsidian -> Rin 博客 发布工具。两步，产物都在本地可检查：
 *   check   <笔记>   转换笔记、整理图片，生成文章包和 preview.html
 *   publish <笔记>   上传图片到 R2，新建或更新博客文章（不加 --yes 只显示计划）
 * 另有 doctor / list / status。详见 tools/obsidian-publish/README.md
 */
import { parseArgs } from "node:util";
import { BlogClient } from "./blog";
import { ARTICLES_DIR, BLOG_SITE, defaultVault, WORKDIR } from "./config";
import { buildBundle, publishNote } from "./pipeline";
import { adminCredentials } from "./secrets";
import { loadState } from "./state";
import { Vault } from "./vault";

const USAGE = `用法:
  obsidian-publish doctor                    检查 Obsidian 库、博客站点、凭据
  obsidian-publish list                      列出「${ARTICLES_DIR}」下的笔记和发布情况
  obsidian-publish check   <笔记>            转换并生成预览
  obsidian-publish publish <笔记> [--yes] [--draft] [--unlisted] [--feed-id N] [--force]
  obsidian-publish status                    已发布笔记与博客文章的对应关系
<笔记> 可以是 .md 文件路径、文章文件夹路径，或文章名里的一段文字（如 DeepSeek）。
Obsidian 库: ${defaultVault()}（可用 OBSIDIAN_VAULT 覆盖）
文章包与状态文件: ${WORKDIR}（可用 RIN_OBSIDIAN_WORKDIR 覆盖）`;

const kb = (n: number) => `${Math.round(n / 1024)}KB`;

async function doctor() {
  let ok = true;
  const step = async (name: string, fn: () => Promise<string>) => {
    try {
      console.log(`✅ ${name}: ${await fn()}`);
    } catch (e) {
      ok = false;
      console.log(`❌ ${name}: ${(e as Error).message}`);
    }
  };
  await step("Obsidian 库", async () => {
    const v = new Vault(defaultVault());
    return `${v.root}（「${ARTICLES_DIR}」下 ${v.articles().length} 篇笔记）`;
  });
  await step("图片转换 sips", async () => (Bun.which("sips") ? "可用" : Promise.reject(new Error("找不到 sips（需要 macOS）"))));
  await step("博客站点", async () => `${BLOG_SITE} HTTP ${(await fetch(BLOG_SITE + "/api/", { signal: AbortSignal.timeout(10_000) })).status}`);
  await step("博客管理员凭据", async () => ((await adminCredentials()), "钥匙串里已存在（未登录验证）"));
  return ok ? 0 : 1;
}

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      yes: { type: "boolean" },
      draft: { type: "boolean" },
      unlisted: { type: "boolean" },
      "feed-id": { type: "string" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, ...rest] = positionals;
  const arg = rest.join(" ");
  if (!cmd || values.help) return console.log(USAGE), 0;

  switch (cmd) {
    case "doctor":
      return doctor();

    case "list": {
      const vault = new Vault(defaultVault());
      const state = await loadState();
      const notes = vault.articles();
      if (!notes.length) console.log(`「${ARTICLES_DIR}」下还没有笔记`);
      for (const n of notes) {
        const r = state.notes[n];
        console.log(`${r ? `#${String(r.feedId).padEnd(5)}` : "未发布"}  ${n}`);
      }
      return 0;
    }

    case "check": {
      if (!arg) throw new Error("需要笔记路径或名字");
      const vault = new Vault(defaultVault());
      const r = await buildBundle(vault, vault.findNote(arg), { site: BLOG_SITE });
      const bytes = r.meta.images.reduce((n, i) => n + i.bytes, 0);
      console.log(`📝 ${r.meta.title}`);
      console.log(`   笔记: ${r.meta.note}`);
      console.log(`   标签: ${r.meta.tags.join("、") || "（无）"}`);
      console.log(`   ${r.markdown.length} 字符, ${r.meta.images.length} 张图 (${kb(bytes)})`);
      console.log(`   预览: ${r.previewPath}`);
      for (const w of r.warnings) console.log(`   ⚠ ${w}`);
      for (const e of r.errors) console.log(`   ❌ ${e}`);
      console.log(r.errors.length ? "   检查未通过" : "   ✅ 检查通过");
      return r.errors.length ? 1 : 0;
    }

    case "publish": {
      if (!arg) throw new Error("需要笔记路径或名字");
      const vault = new Vault(defaultVault());
      const note = vault.findNote(arg);
      const feedId = values["feed-id"] ? Number(values["feed-id"]) : undefined;
      if (feedId !== undefined && !Number.isInteger(feedId)) throw new Error("--feed-id 必须是整数");
      const blog = new BlogClient();
      const { username, password } = await adminCredentials();
      await blog.login(username, password);
      const r = await publishNote(vault, note, blog, {
        yes: values.yes,
        draft: values.draft,
        unlisted: values.unlisted,
        feedId,
        force: values.force,
      });
      const p = r.plan;
      const verb = { create: "新建文章", update: `更新文章 #${p.feedId}`, unchanged: `文章 #${p.feedId} 内容没有变化` }[p.action];
      console.log(`🚀 ${verb}: ${p.title}`);
      console.log(`   笔记: ${note}`);
      console.log(`   状态: ${p.draft ? "草稿" : "公开"}${p.listed ? "" : "（不在首页列出）"}，需上传图片 ${p.imagesToUpload} 张`);
      for (const w of r.report.warnings) console.log(`   ⚠ ${w}`);
      if (r.done) console.log(`   ✅ 已完成: ${r.url}`);
      else if (p.action !== "unchanged") console.log(`   预览: ${r.report.previewPath}\n   （只是计划，没有写入博客。确认后加 --yes 执行）`);
      return 0;
    }

    case "status": {
      const state = await loadState();
      const rows = Object.entries(state.notes);
      if (!rows.length) console.log("还没有通过本工具发布过笔记");
      for (const [note, r] of rows) console.log(`#${r.feedId}  ${r.publishedAt.slice(0, 16)}  ${note}  ${r.title}`);
      return 0;
    }

    default:
      console.log(USAGE);
      return 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`❌ ${(e as Error).message}`);
      process.exit(1);
    },
  );
}

export { main };
