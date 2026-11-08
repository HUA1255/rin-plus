import { mkdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { BlogClient } from "./blog";
import { IMAGE_EXTS, WORKDIR } from "./config";
import { prepareImage } from "./images";
import { convertObsidian, readNoteMeta, rewriteImageUrls, splitFrontMatter, takeLeadingH1 } from "./markdown";
import { loadState, saveState, sha256, statePath, type PublishState } from "./state";
import { noteSlug, type Vault } from "./vault";

/**
 * A bundle is one note prepared for publishing, rebuilt from the vault on every check/publish:
 *   <WORKDIR>/bundles/<slug>/post.md       converted markdown, images as images/NN.ext
 *   <WORKDIR>/bundles/<slug>/images/       images copied from the vault (SVG rendered to PNG)
 *   <WORKDIR>/bundles/<slug>/meta.json     BundleMeta, incl. upload results
 *   <WORKDIR>/bundles/<slug>/preview.html  local preview with the blog's render pipeline
 * The vault itself is never written to.
 */
export interface BundleImage {
  index: number;
  /** Vault-relative path of the original file. */
  source: string;
  file: string;
  bytes: number;
  contentType: string;
  sha256: string;
  /** Public R2 URL after upload; reused while the image bytes are unchanged. */
  uploadedUrl?: string;
}

export interface BundleMeta {
  version: 1;
  note: string;
  title: string;
  tags: string[];
  alias?: string;
  summary?: string;
  createdAt?: string;
  status?: string;
  builtAt: string;
  images: BundleImage[];
}

export interface BuildOptions {
  workdir?: string;
  statePath?: string;
  /** Blog origin used for links to notes that are already published. */
  site?: string;
}

export interface CheckReport {
  dir: string;
  meta: BundleMeta;
  markdown: string;
  errors: string[];
  warnings: string[];
  previewPath: string;
}

export const bundleDir = (notePath: string, workdir = WORKDIR) => join(workdir, "bundles", noteSlug(notePath));

const PLACEHOLDER = (i: number) => `obsidian-image-${i}.invalid`;
const VAULT_REF = "obsidian-vault:";
const MISSING = "obsidian-missing.invalid";

export async function buildBundle(vault: Vault, notePath: string, opts: BuildOptions = {}): Promise<CheckReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const state = await loadState(opts.statePath ?? statePath(opts.workdir));
  const { fm, body: rawBody } = splitFrontMatter(await Bun.file(vault.abs(notePath)).text());
  const fmMeta = readNoteMeta(fm);
  const h1 = takeLeadingH1(rawBody);
  const title = fmMeta.title || h1.title || noteSlug(notePath).replace(/^\d{4}-\d{2}-\d{2}[-_ ]*/, "");

  // Every local image gets an index in order of first appearance.
  const images = new Map<string, number>();
  const addImage = (rel: string) => {
    if (!images.has(rel)) images.set(rel, images.size + 1);
    return PLACEHOLDER(images.get(rel)!);
  };

  const converted = convertObsidian(h1.title && !fmMeta.title ? h1.body : rawBody, {
    embed(target, option) {
      const file = target.split("#")[0]!;
      if (!IMAGE_EXTS.has(extname(file).toLowerCase())) {
        warnings.push(`嵌入的笔记/文件不会展开，只保留名字：![[${target}]]`);
        return option || file.replace(/\.md$/, "");
      }
      const rel = vault.resolveLink(file, notePath);
      if (!rel) {
        errors.push(`找不到图片：![[${target}]]`);
        return `![](${MISSING})`;
      }
      // Numbered later, together with ordinary images, in document order.
      const src = VAULT_REF + encodeURIComponent(rel).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
      const size = option?.match(/^(\d+)(?:x(\d+))?$/);
      if (size) return `<img src="${src}" alt="" width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ""}>`;
      return `![${option ?? ""}](${src})`;
    },
    link(target, label) {
      const [file, heading] = target.split("#");
      const text = label || (file ? file.replace(/\.md$/, "") : heading?.replace(/^\^/, "")) || target;
      if (!file) return text; // [[#heading]] inside the same note
      const rel = vault.resolveLink(file, notePath);
      const feedId = rel ? state.notes[rel]?.feedId : undefined;
      if (feedId !== undefined && opts.site) return `[${text}](${opts.site}/feed/${feedId})`;
      return text;
    },
  });

  // Standard markdown / HTML images: relative paths point into the vault.
  const markdownWithPlaceholders = rewriteImageUrls(converted, (url) => {
    if (url === MISSING) return url;
    if (url.startsWith(VAULT_REF)) return addImage(decodeURIComponent(url.slice(VAULT_REF.length)));
    if (/^(https?:|data:)/i.test(url)) {
      warnings.push(`外链图片不会转存，请确认能长期访问：${url}`);
      return url;
    }
    let path = url;
    try {
      path = decodeURI(url);
    } catch {
      // keep as-is
    }
    const rel = vault.resolveLink(path, notePath);
    if (!rel || !IMAGE_EXTS.has(extname(rel).toLowerCase())) {
      errors.push(`找不到图片：${url}`);
      return url;
    }
    return addImage(rel);
  });

  // Rebuild images/ from scratch; keep upload results for unchanged bytes.
  const dir = bundleDir(notePath, opts.workdir);
  const previous = (await Bun.file(join(dir, "meta.json"))
    .json()
    .catch(() => null)) as BundleMeta | null;
  const uploaded = new Map((previous?.images ?? []).filter((i) => i.uploadedUrl).map((i) => [i.sha256, i.uploadedUrl!]));
  const imgDir = join(dir, "images");
  await rm(imgDir, { recursive: true, force: true });
  await mkdir(imgDir, { recursive: true });

  const bundleImages: BundleImage[] = [];
  const fileByIndex = new Map<number, string>();
  for (const [rel, index] of images) {
    try {
      const p = await prepareImage(vault.abs(rel), imgDir, index);
      const file = `images/${p.name}`;
      fileByIndex.set(index, file);
      bundleImages.push({ index, source: rel, file, bytes: p.bytes, contentType: p.contentType, sha256: p.sha256, uploadedUrl: uploaded.get(p.sha256) });
    } catch (e) {
      errors.push(`图片 ${rel} 处理失败：${(e as Error).message}`);
    }
  }
  const markdown = rewriteImageUrls(markdownWithPlaceholders, (u) => {
    const i = u.match(/^obsidian-image-(\d+)\.invalid$/)?.[1];
    return i ? (fileByIndex.get(Number(i)) ?? u) : u;
  });

  if (!title.trim()) errors.push("标题为空");
  if (!markdown.trim()) errors.push("正文为空");
  if (fmMeta.status && /草稿|draft/i.test(fmMeta.status)) warnings.push(`笔记 frontmatter 状态是「${fmMeta.status}」（只是提示，不影响发布）`);

  const meta: BundleMeta = {
    version: 1,
    note: notePath,
    title,
    tags: fmMeta.tags,
    alias: fmMeta.alias,
    summary: fmMeta.summary,
    createdAt: fmMeta.createdAt,
    status: fmMeta.status,
    builtAt: new Date().toISOString(),
    images: bundleImages,
  };
  await Bun.write(join(dir, "post.md"), markdown);
  await Bun.write(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  const previewPath = join(dir, "preview.html");
  await Bun.write(previewPath, await renderPreviewHtml(title, markdown));
  return { dir, meta, markdown, errors: [...new Set(errors)], warnings: [...new Set(warnings)], previewPath };
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
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--code:#f6f8fa;--mark:#fff3a3}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--code:#161b22;--mark:#5c4b00}}
body{background:var(--bg);color:var(--fg);font:16px/1.75 -apple-system,"PingFang SC",sans-serif;max-width:760px;margin:0 auto;padding:24px 16px}
img{max-width:100%;border-radius:6px}pre,code{background:var(--code);border-radius:4px}pre{padding:12px;overflow:auto}
code{padding:.1em .3em}table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:4px 8px}
blockquote{color:var(--muted);border-left:4px solid var(--line);margin:0;padding-left:12px}mark{background:var(--mark);color:inherit}
</style></head><body><h1>${esc}</h1>${html}</body></html>`;
}

// ---------- publish ----------

export interface PublishOptions extends BuildOptions {
  /** Without yes, only the plan is returned and nothing is written to the blog. */
  yes?: boolean;
  draft?: boolean;
  unlisted?: boolean;
  /** Link this note to an existing post (e.g. one first published from Yuque). */
  feedId?: number;
  /** Update even if the content hash is unchanged. */
  force?: boolean;
}

export interface PublishPlan {
  action: "create" | "update" | "unchanged";
  feedId?: number;
  title: string;
  imagesToUpload: number;
  draft: boolean;
  listed: boolean;
}

export async function publishNote(vault: Vault, notePath: string, blog: BlogClient, opts: PublishOptions = {}) {
  const sPath = opts.statePath ?? statePath(opts.workdir);
  const report = await buildBundle(vault, notePath, { ...opts, statePath: sPath, site: blog.site });
  if (report.errors.length) throw new Error("检查未通过，不能发布：\n  - " + report.errors.join("\n  - "));
  const { dir, meta, markdown } = report;

  const state: PublishState = await loadState(sPath);
  const record = state.notes[notePath];
  const draft = Boolean(opts.draft);
  const listed = !opts.unlisted;
  const contentSha = sha256(
    [meta.title, meta.tags.join(","), meta.alias ?? "", meta.summary ?? "", meta.createdAt ?? "", String(draft), String(listed), markdown, ...meta.images.map((i) => i.sha256)].join("\n"),
  );

  let feedId: number | undefined = opts.feedId ?? record?.feedId;
  if (feedId !== undefined && !(await blog.getFeed(feedId))) {
    if (opts.feedId !== undefined) throw new Error(`博客里找不到文章 ${feedId}`);
    feedId = undefined; // the post was deleted on the blog: publish a new one
  }
  const pending = meta.images.filter((img) => !img.uploadedUrl);
  const plan: PublishPlan = {
    action: feedId === undefined ? "create" : !opts.force && record?.feedId === feedId && record.contentSha256 === contentSha ? "unchanged" : "update",
    feedId,
    title: meta.title,
    imagesToUpload: pending.length,
    draft,
    listed,
  };
  if (!opts.yes || plan.action === "unchanged") return { plan, report, done: false as const };

  for (const img of pending) {
    const bytes = new Uint8Array(await Bun.file(join(dir, img.file)).arrayBuffer());
    img.uploadedUrl = await blog.uploadImage(bytes, img.file.split("/").pop()!, img.contentType);
    await Bun.write(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n"); // keep progress if a later step fails
  }
  const byFile = new Map(meta.images.map((img) => [img.file, img.uploadedUrl!]));
  const content = rewriteImageUrls(markdown, (u) => byFile.get(u) ?? u);

  const body = {
    title: meta.title,
    content,
    tags: meta.tags,
    draft,
    listed,
    ...(meta.alias ? { alias: meta.alias } : {}),
    ...(meta.summary ? { summary: meta.summary } : {}),
    ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
  };
  if (feedId === undefined) feedId = await blog.createFeed(body);
  else await blog.updateFeed(feedId, body);

  state.notes[notePath] = { title: meta.title, feedId, publishedAt: new Date().toISOString(), contentSha256: contentSha };
  await saveState(state, sPath);
  return { plan: { ...plan, feedId }, report, done: true as const, url: blog.postUrl(feedId) };
}
