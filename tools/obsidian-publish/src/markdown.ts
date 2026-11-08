/**
 * Turn Obsidian-flavored markdown into the plain GFM + HTML the blog renders
 * (react-markdown + remark-gfm + rehype-raw).
 */

// ---------- front matter ----------

export interface NoteMeta {
  title?: string;
  tags: string[];
  alias?: string;
  summary?: string;
  createdAt?: string;
  /** Free-form writing status such as 草稿 / 已发布; shown only. */
  status?: string;
}

const pickKey = (fm: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = fm[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

const asText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === undefined ? undefined : String(v).trim());

export function splitFrontMatter(text: string): { fm: Record<string, unknown>; body: string } {
  text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { fm: {}, body: text };
  let fm: unknown;
  try {
    fm = (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML.parse(m[1]!); // older @types/bun lacks YAML
  } catch (e) {
    throw new Error(`frontmatter（开头 --- 之间）不是合法 YAML：${(e as Error).message}`);
  }
  return { fm: fm && typeof fm === "object" ? (fm as Record<string, unknown>) : {}, body: text.slice(m[0].length) };
}

/** Front matter keys, Chinese first since that is what the vault uses. */
export function readNoteMeta(fm: Record<string, unknown>): NoteMeta {
  const rawTags = pickKey(fm, ["标签", "tags", "tag"]);
  const tags = (Array.isArray(rawTags) ? rawTags : typeof rawTags === "string" ? rawTags.split(/[,，\s]+/) : [])
    .map((t) => String(t).trim().replace(/^#/, ""))
    .filter(Boolean);
  const date = asText(pickKey(fm, ["发布日期", "日期", "date"]));
  return {
    title: asText(pickKey(fm, ["标题", "title"])),
    tags: [...new Set(tags)],
    alias: asText(pickKey(fm, ["别名", "alias", "slug"])),
    summary: asText(pickKey(fm, ["摘要", "summary", "description"])),
    createdAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : undefined,
    status: asText(pickKey(fm, ["状态", "status"])),
  };
}

/** Use the first line `# Title` as the title (and drop it) when it opens the note. */
export function takeLeadingH1(body: string): { title?: string; body: string } {
  const m = body.match(/^\s*#[ \t]+(.+?)[ \t#]*\n/);
  if (!m) return { body };
  return { title: m[1]!.trim(), body: body.slice(m[0].length) };
}

// ---------- code-aware mapping ----------

/** Apply fn only outside fenced code blocks and inline code spans. */
export function mapOutsideCode(markdown: string, fn: (prose: string) => string): string {
  const out: string[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (buf.length) out.push(mapOutsideInlineCode(buf.join("\n"), fn));
    buf = [];
  };
  for (const line of markdown.split("\n")) {
    const opener = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (fence === null && opener) {
      flush();
      fence = opener;
      out.push(line);
    } else if (fence !== null) {
      out.push(line);
      if (line.trimStart().startsWith(fence)) fence = null;
    } else {
      buf.push(line);
    }
  }
  flush();
  return out.join("\n");
}

function mapOutsideInlineCode(text: string, fn: (prose: string) => string): string {
  return text
    .split(/(`+[^`\n]*?`+)/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

// ---------- Obsidian syntax ----------

export interface ConvertHooks {
  /** `![[target|option]]`; return replacement markdown. */
  embed(target: string, option: string | undefined): string;
  /** `[[target|label]]`; return replacement markdown. */
  link(target: string, label: string | undefined): string;
}

const HTML_TAGS = new Set(
  `a abbr b blockquote br code del details div em figcaption figure font h1 h2 h3 h4 h5 h6 hr i img ins
   kbd li mark ol p pre q s small span strong sub summary sup table tbody td th thead tr u ul video audio
   source iframe center`.split(/\s+/),
);

/** <https://…> and <a@b.c> are markdown autolinks, not tags. */
const AUTOLINK = /^<(?:[a-z][\w+.-]*:[^\s<>]+|[^\s<>@]+@[^\s<>@]+)>$/i;

/** `<Agent账号>` would be swallowed as an unknown tag by rehype-raw. */
function escapeUnknownTags(text: string): string {
  return text.replace(/<(\/?)([^\s<>/!]+)([^<>]*)>/g, (m, _slash, name: string) =>
    HTML_TAGS.has(name.toLowerCase()) || AUTOLINK.test(m) ? m : `&lt;${m.slice(1, -1)}&gt;`,
  );
}

const CALLOUT_NAMES: Record<string, string> = {
  note: "注意", info: "信息", tip: "提示", hint: "提示", important: "重要", warning: "警告", caution: "警告",
  attention: "注意", danger: "危险", error: "错误", bug: "Bug", example: "示例", quote: "引用", cite: "引用",
  question: "问题", faq: "问题", help: "问题", success: "完成", check: "完成", done: "完成", failure: "失败",
  fail: "失败", missing: "缺失", abstract: "摘要", summary: "摘要", tldr: "摘要", todo: "待办",
};

function convertProse(text: string, hooks: ConvertHooks): string {
  // %% comments %% are private to Obsidian
  text = text.replace(/%%[\s\S]*?%%/g, "");
  // ![[embed]] before [[link]]
  text = text.replace(/!\[\[([^\]\n]+?)\]\]/g, (_m, inner: string) => {
    const [target, ...rest] = inner.split(/\\?\|/); // "\|" inside tables
    return hooks.embed(target!.trim(), rest.length ? rest.join("|").trim() : undefined);
  });
  text = text.replace(/\[\[([^\]\n]+?)\]\]/g, (_m, inner: string) => {
    const [target, ...rest] = inner.split(/\\?\|/); // "\|" inside tables
    return hooks.link(target!.trim(), rest.length ? rest.join("|").trim() : undefined);
  });
  // ==highlight==
  text = text.replace(/(^|[^=])==(?!=)([^=\n]+?)==(?!=)/g, (_m, pre: string, inner: string) => `${pre}<mark>${inner}</mark>`);
  // > [!type]+ Title  ->  > **Title**
  text = text.replace(/^([ \t]*>[ \t]*)\[!([\w-]+)\][+-]?[ \t]*(.*)$/gm, (_m, quote: string, type: string, title: string) => {
    const label = title.trim() || CALLOUT_NAMES[type.toLowerCase()] || type;
    return `${quote}**${label}**`;
  });
  // block ids: "text ^abc123" at line end
  text = text.replace(/[ \t]+\^[\w-]+[ \t]*$/gm, "");
  return escapeUnknownTags(text);
}

export function convertObsidian(body: string, hooks: ConvertHooks): string {
  return mapOutsideCode(body, (prose) => convertProse(prose, hooks)).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ---------- images ----------

// One pass over both forms so images are visited in document order.
const IMAGE = /!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))([ \t]+"[^"]*")?\s*\)|(<img\b[^>]*?\bsrc=")([^"]+)(")/gi;

/** Rewrite every image URL in markdown (both ![]() and <img src>), outside code. */
export function rewriteImageUrls(markdown: string, map: (url: string) => string): string {
  return mapOutsideCode(markdown, (prose) =>
    prose.replace(IMAGE, (_m, alt?: string, angled?: string, bare?: string, title = "", pre?: string, src?: string, post?: string) => {
      if (pre !== undefined) return pre + map(src!) + post;
      const url = map(angled ?? bare!);
      return `![${alt}](${/\s/.test(url) ? `<${url}>` : url}${title ?? ""})`;
    }),
  );
}

export function extractImageUrls(markdown: string): string[] {
  const urls: string[] = [];
  rewriteImageUrls(markdown, (u) => (urls.push(u), u));
  return [...new Set(urls)];
}
