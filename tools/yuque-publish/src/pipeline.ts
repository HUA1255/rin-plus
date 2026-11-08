import { rm } from "node:fs/promises";
import { join } from "node:path";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { MAX_UPLOAD_BYTES, YUQUE_IMAGE_HOST } from "./config";
import type { BlogClient } from "./blog";
import { bundleDir, readBundle, saveMeta, writeBundle, type BundleImage, type BundleMeta } from "./bundle";
import { cleanBody } from "./clean";
import { extractImageUrls, localizeImages, rewriteImageUrls, type LocalizeOptions } from "./images";
import { loadState, saveState, sha256, statePath, type PublishRecord } from "./state";
import type { YuqueClient } from "./yuque";

// ---------- fetch ----------

export interface FetchOptions extends LocalizeOptions {
  alias?: string;
  workdir?: string;
}

export async function fetchBundle(yuque: YuqueClient, namespace: string, slug: string, opts: FetchOptions = {}) {
  const doc = await yuque.getDoc(namespace, slug);
  const dir = bundleDir(doc.slug, opts.workdir);
  const cleaned = cleanBody(doc.body);
  const sources = extractImageUrls(cleaned).filter((u) => YUQUE_IMAGE_HOST.test(u));

  // Re-fetch: drop local files whose position now holds a different image, keep uploads that still match.
  const previous = await readBundle(dir).then((b) => b.meta).catch(() => null);
  const keepUploads = new Map<string, BundleImage>();
  for (const img of previous?.images ?? []) {
    if (sources[img.index - 1] === img.sourceUrl) keepUploads.set(img.sourceUrl, img);
    else if (img.file) await rm(join(dir, img.file), { force: true });
  }

  const { markdown, images, failures } = await localizeImages(cleaned, dir, opts);
  for (const img of images) {
    const old = keepUploads.get(img.sourceUrl);
    if (old?.uploadedUrl) Object.assign(img, { uploadedUrl: old.uploadedUrl, uploadedSha256: old.uploadedSha256 });
  }

  const meta: BundleMeta = {
    version: 1,
    source: { namespace, slug: doc.slug, docId: doc.id, updatedAt: doc.updatedAt },
    title: doc.title,
    tags: doc.tags,
    alias: opts.alias ?? previous?.alias,
    fetchedAt: new Date().toISOString(),
    images,
  };
  await writeBundle(dir, meta, markdown);
  return { dir, meta, failures };
}

// ---------- check ----------

export interface CheckReport {
  errors: string[];
  warnings: string[];
  stats: { chars: number; images: number; imageBytes: number };
  previewPath: string;
}

export async function renderPreviewHtml(title: string, markdown: string): Promise<string> {
  const html = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeStringify)
      .process(markdown),
  );
  const esc = title.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc}</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--code:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--code:#161b22}}
body{background:var(--bg);color:var(--fg);font:16px/1.75 -apple-system,"PingFang SC",sans-serif;max-width:760px;margin:0 auto;padding:24px 16px}
img{max-width:100%;border-radius:6px}pre,code{background:var(--code);border-radius:4px}pre{padding:12px;overflow:auto}
code{padding:.1em .3em}table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:4px 8px}
blockquote{color:var(--muted);border-left:4px solid var(--line);margin:0;padding-left:12px}
</style></head><body><h1>${esc}</h1>${html}</body></html>`;
}

export async function checkBundle(dir: string): Promise<CheckReport> {
  const { meta, markdown } = await readBundle(dir);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!meta.title.trim()) errors.push("标题为空");
  if (!markdown.trim()) errors.push("正文为空");

  const missing = new Set<string>();
  for (const img of meta.images) {
    if (!img.file) {
      missing.add(img.sourceUrl);
      errors.push(`图片 ${String(img.index).padStart(2, "0")} 没有本地文件（发布后会因防盗链裂图）：${img.sourceUrl}`);
    }
  }
  for (const url of extractImageUrls(markdown)) {
    if (missing.has(url)) continue;
    if (YUQUE_IMAGE_HOST.test(url)) {
      errors.push(`正文仍引用语雀图片（发布后会因防盗链裂图）：${url}`);
    } else if (!/^(https?:|data:)/.test(url)) {
      const f = Bun.file(join(dir, url));
      if (!(await f.exists())) errors.push(`正文引用的本地图片不存在：${url}`);
      else if (f.size > MAX_UPLOAD_BYTES) errors.push(`图片超过 5MB 上传上限：${url}`);
    } else {
      warnings.push(`外链图片不会转存，请确认能长期访问：${url}`);
    }
  }
  if (/<font\b/i.test(markdown)) warnings.push("正文仍有 <font> 标签");

  const previewPath = join(dir, "preview.html");
  await Bun.write(previewPath, await renderPreviewHtml(meta.title, markdown));
  return {
    errors,
    warnings,
    stats: {
      chars: markdown.length,
      images: meta.images.length,
      imageBytes: meta.images.reduce((n, i) => n + (i.bytes ?? 0), 0),
    },
    previewPath,
  };
}

// ---------- publish ----------

export interface PublishOptions {
  /** Without yes, only the plan is returned and nothing is written to the blog. */
  yes?: boolean;
  draft?: boolean;
  unlisted?: boolean;
  /** Link this doc to an existing post (e.g. one published before the state file existed). */
  feedId?: number;
  /** Update even if the content hash is unchanged. */
  force?: boolean;
  statePath?: string;
}

export interface PublishPlan {
  action: "create" | "update" | "unchanged";
  feedId?: number;
  title: string;
  imagesToUpload: number;
  draft: boolean;
  listed: boolean;
}

export async function publishBundle(dir: string, blog: BlogClient, opts: PublishOptions = {}) {
  const report = await checkBundle(dir);
  if (report.errors.length) throw new Error("检查未通过，不能发布：\n  - " + report.errors.join("\n  - "));

  const { meta, markdown } = await readBundle(dir);
  const sPath = opts.statePath ?? statePath();
  const state = await loadState(sPath);
  const key = String(meta.source.docId);
  const record: PublishRecord | undefined = state.docs[key];
  const draft = Boolean(opts.draft);
  const listed = !opts.unlisted;

  // sha of bundle content + images decides whether an update is needed
  const imageHashes: string[] = [];
  for (const img of meta.images) imageHashes.push(sha256(new Uint8Array(await Bun.file(join(dir, img.file!)).arrayBuffer())));
  const contentSha = sha256([meta.title, meta.tags.join(","), meta.alias ?? "", String(draft), String(listed), markdown, ...imageHashes].join("\n"));

  let feedId: number | undefined = opts.feedId ?? record?.feedId;
  if (feedId !== undefined && !(await blog.getFeed(feedId))) {
    if (opts.feedId !== undefined) throw new Error(`博客里找不到文章 ${feedId}`);
    feedId = undefined; // the post was deleted on the blog: publish a new one
  }
  const pending = meta.images.filter((img, i) => !img.uploadedUrl || img.uploadedSha256 !== imageHashes[i]);
  const plan: PublishPlan = {
    action: feedId === undefined ? "create" : !opts.force && record?.feedId === feedId && record.contentSha256 === contentSha ? "unchanged" : "update",
    feedId,
    title: meta.title,
    imagesToUpload: pending.length,
    draft,
    listed,
  };
  if (!opts.yes || plan.action === "unchanged") return { plan, report, done: false as const };

  for (const [i, img] of meta.images.entries()) {
    if (!pending.includes(img)) continue;
    const bytes = new Uint8Array(await Bun.file(join(dir, img.file!)).arrayBuffer());
    img.uploadedUrl = await blog.uploadImage(bytes, img.file!.split("/").pop()!, img.contentType!);
    img.uploadedSha256 = imageHashes[i];
    await saveMeta(dir, meta); // keep progress if a later step fails
  }
  const byFile = new Map(meta.images.map((img) => [img.file!, img.uploadedUrl!]));
  const content = rewriteImageUrls(markdown, (u) => byFile.get(u) ?? u);

  const body = { title: meta.title, content, tags: meta.tags, draft, listed, ...(meta.alias ? { alias: meta.alias } : {}) };
  if (feedId === undefined) feedId = await blog.createFeed(body);
  else await blog.updateFeed(feedId, body);

  state.docs[key] = {
    namespace: meta.source.namespace,
    slug: meta.source.slug,
    title: meta.title,
    feedId,
    publishedAt: new Date().toISOString(),
    sourceUpdatedAt: meta.source.updatedAt,
    contentSha256: contentSha,
  };
  await saveState(state, sPath);
  return { plan: { ...plan, feedId }, report, done: true as const, url: blog.postUrl(feedId) };
}
