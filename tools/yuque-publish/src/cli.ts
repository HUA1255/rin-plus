#!/usr/bin/env bun
/**
 * 语雀 -> Rin 博客 发布工具。三步，每步产物都在本地可检查：
 *   fetch   <语雀文档URL>   拉取文档、清洗正文、把语雀图片转成本地文件 -> 文章包
 *   check   <slug|目录>     校验文章包并生成 preview.html
 *   publish <slug|目录>     上传图片到 R2，新建或更新博客文章（不加 --yes 只显示计划）
 * 另有 doctor / list / status。详见 tools/yuque-publish/README.md
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { BlogClient } from "./blog";
import { BLOG_SITE, WORKDIR } from "./config";
import { bundleDir } from "./bundle";
import { checkBundle, fetchBundle, publishBundle } from "./pipeline";
import { adminCredentials, yuqueToken } from "./secrets";
import { loadState } from "./state";
import { parseYuqueUrl, YuqueClient } from "./yuque";

const USAGE = `用法:
  yuque-publish doctor                          检查 Token、网络、凭据
  yuque-publish list    <语雀知识库URL>          列出文档
  yuque-publish fetch   <语雀文档URL> [--images-from 目录] [--offline] [--alias 别名]
  yuque-publish check   <slug|文章包目录>
  yuque-publish publish <slug|文章包目录> [--yes] [--draft] [--unlisted] [--feed-id N] [--force]
  yuque-publish status                          已发布文档与博客文章的对应关系
文章包与状态文件目录: ${WORKDIR}（可用 RIN_YUQUE_WORKDIR 覆盖）`;

const resolveDir = (arg: string) => (existsSync(arg) ? arg : bundleDir(arg));
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
  await step("语雀 Token", async () => `登录名 ${(await new YuqueClient(await yuqueToken()).user()).login}`);
  await step("语雀图片 CDN", async () => {
    const res = await fetch("https://cdn.nlark.com/", { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return `HTTP ${res.status}（能连上；连不上时用 fetch --images-from 手动提供图片）`;
  });
  await step("博客站点", async () => `${BLOG_SITE} HTTP ${(await fetch(BLOG_SITE + "/api/", { signal: AbortSignal.timeout(10_000) })).status}`);
  await step("博客管理员凭据", async () => ((await adminCredentials()), "钥匙串里已存在（未登录验证）"));
  return ok ? 0 : 1;
}

async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "images-from": { type: "string" },
      offline: { type: "boolean" },
      alias: { type: "string" },
      yes: { type: "boolean" },
      draft: { type: "boolean" },
      unlisted: { type: "boolean" },
      "feed-id": { type: "string" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, arg] = positionals;
  if (!cmd || values.help) return console.log(USAGE), 0;

  switch (cmd) {
    case "doctor":
      return doctor();

    case "list": {
      if (!arg) throw new Error("需要语雀知识库 URL");
      const { namespace } = parseYuqueUrl(arg);
      for (const d of await new YuqueClient(await yuqueToken()).listDocs(namespace)) {
        console.log(`${d.slug.padEnd(24)} ${d.updated_at.slice(0, 10)}  ${d.title}`);
      }
      return 0;
    }

    case "fetch": {
      if (!arg) throw new Error("需要语雀文档 URL");
      const { namespace, slug } = parseYuqueUrl(arg);
      if (!slug) throw new Error("这是知识库 URL；fetch 需要具体文档 URL（可先用 list 查看）");
      const { dir, meta, failures } = await fetchBundle(new YuqueClient(await yuqueToken()), namespace, slug, {
        manualDir: values["images-from"],
        offline: values.offline,
        alias: values.alias,
      });
      console.log(`📦 ${meta.title}\n   文章包: ${dir}`);
      console.log(`   图片: ${meta.images.length - failures.length}/${meta.images.length} 张已在本地`);
      if (failures.length) {
        console.log("   以下图片需要手动提供（按编号保存到一个目录，再用 --images-from 目录 重新 fetch）：");
        for (const f of failures) console.log(`     ${String(f.index).padStart(2, "0")}.png  ${f.url}  (${f.error})`);
        return 1;
      }
      console.log("   下一步: check " + meta.source.slug);
      return 0;
    }

    case "check": {
      if (!arg) throw new Error("需要 slug 或文章包目录");
      const r = await checkBundle(resolveDir(arg));
      console.log(`📝 ${r.stats.chars} 字符, ${r.stats.images} 张图 (${kb(r.stats.imageBytes)})`);
      console.log(`   预览: ${r.previewPath}`);
      for (const w of r.warnings) console.log(`   ⚠ ${w}`);
      for (const e of r.errors) console.log(`   ❌ ${e}`);
      console.log(r.errors.length ? "   检查未通过" : "   ✅ 检查通过");
      return r.errors.length ? 1 : 0;
    }

    case "publish": {
      if (!arg) throw new Error("需要 slug 或文章包目录");
      const blog = new BlogClient();
      const { username, password } = await adminCredentials();
      await blog.login(username, password);
      const feedId = values["feed-id"] ? Number(values["feed-id"]) : undefined;
      if (feedId !== undefined && !Number.isInteger(feedId)) throw new Error("--feed-id 必须是整数");
      const r = await publishBundle(resolveDir(arg), blog, {
        yes: values.yes,
        draft: values.draft,
        unlisted: values.unlisted,
        feedId,
        force: values.force,
      });
      const p = r.plan;
      const verb = { create: "新建文章", update: `更新文章 #${p.feedId}`, unchanged: `文章 #${p.feedId} 内容没有变化` }[p.action];
      console.log(`🚀 ${verb}: ${p.title}`);
      console.log(`   状态: ${p.draft ? "草稿" : "公开"}${p.listed ? "" : "（不在首页列出）"}，需上传图片 ${p.imagesToUpload} 张`);
      if (r.done) console.log(`   ✅ 已完成: ${r.url}`);
      else if (p.action !== "unchanged") console.log("   （只是计划，没有写入博客。确认后加 --yes 执行）");
      return 0;
    }

    case "status": {
      const state = await loadState();
      const rows = Object.entries(state.docs);
      if (!rows.length) console.log("还没有通过本工具发布过文档");
      for (const [docId, r] of rows) {
        console.log(`#${r.feedId}  ${r.publishedAt.slice(0, 16)}  ${r.namespace}/${r.slug} (doc ${docId})  ${r.title}`);
      }
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
