import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CreateFeedRequest, UpdateFeedRequest } from "@rin/api";
import { BlogClient, type BlogFeedSummary } from "../blog";
import { sniffImageType } from "../images";
import { convertObsidian, extractImageUrls, readNoteMeta, splitFrontMatter, takeLeadingH1 } from "../markdown";
import { buildBundle, publishNote } from "../pipeline";
import { loadState } from "../state";
import { noteSlug, Vault } from "../vault";

// 1x1 PNG
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);
/** SVG rendering uses macOS `sips`; tests that need it are skipped elsewhere (e.g. Linux CI). */
const HAS_SIPS = Bun.which("sips") !== null;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#3a6"/></svg>`;

const plain = { embed: (t: string) => `[embed:${t}]`, link: (t: string, l?: string) => l ?? t };

describe("markdown", () => {
  it("reads Chinese front matter and the leading H1", () => {
    const { fm, body } = splitFrontMatter("---\n类型: 文章\n状态: 草稿\n创建: 2026-11-04\n标签:\n  - A\n  - '#B'\n---\n\n# 标题一\n\n正文\n");
    const meta = readNoteMeta(fm);
    expect(meta.tags).toEqual(["A", "B"]);
    expect(meta.status).toBe("草稿");
    expect(meta.createdAt).toBeUndefined(); // 创建 is the note's date, not the publish date
    expect(takeLeadingH1(body)).toEqual({ title: "标题一", body: "\n正文\n" });
  });

  it("converts Obsidian syntax outside code only", () => {
    const md = [
      "前 %%私密%% 后",
      "%%",
      "多行注释",
      "%%",
      "这是 ==重点== 和 [[别的笔记|别名]]、[[第三篇]]、[[#小节]]",
      "> [!warning] 小心",
      "> 内容",
      "> [!tip]",
      "段落 ^abc123",
      "<Agent账号> 和 <https://example.com>",
      "| a | [[笔记\\|显示]] |",
      "`[[不动]] ==不动==`",
      "```",
      "[[也不动]] %%x%% <T>",
      "```",
    ].join("\n");
    const out = convertObsidian(md, plain);
    expect(out).toContain("前  后");
    expect(out).not.toContain("多行注释");
    expect(out).toContain("这是 <mark>重点</mark> 和 别名、第三篇、#小节");
    expect(out).toContain("> **小心**\n> 内容\n> **提示**");
    expect(out).toContain("段落\n");
    expect(out).toContain("&lt;Agent账号&gt; 和 <https://example.com>");
    expect(out).toContain("| a | 显示 |");
    expect(out).toContain("`[[不动]] ==不动==`");
    expect(out).toContain("[[也不动]] %%x%% <T>");
  });

  it("extracts image urls including <angle> paths with spaces", () => {
    expect(extractImageUrls('![a](<images/my pic.png>) ![b](x.png "t") <img src="y.svg">')).toEqual(["images/my pic.png", "x.png", "y.svg"]);
  });

  it("sniffs avif", () => {
    expect(sniffImageType(new Uint8Array([0, 0, 0, 0x1c, ...new TextEncoder().encode("ftypavif")]))).toBe("image/avif");
  });
});

class FakeBlog extends BlogClient {
  feeds = new Map<number, BlogFeedSummary & { content: string }>();
  uploads: string[] = [];
  creates: CreateFeedRequest[] = [];
  updates: Array<[number, UpdateFeedRequest]> = [];
  constructor() {
    super("https://blog.test");
  }
  override async uploadImage(_b: Uint8Array<ArrayBuffer>, filename: string) {
    this.uploads.push(filename);
    return `https://img.test/${this.uploads.length}-${filename}`;
  }
  override async getFeed(id: number) {
    return this.feeds.get(id) ?? null;
  }
  override async createFeed(req: CreateFeedRequest) {
    this.creates.push(req);
    const id = 100 + this.creates.length;
    this.feeds.set(id, { id, title: req.title, draft: req.draft ? 1 : 0, listed: 1, content: req.content });
    return id;
  }
  override async updateFeed(id: number, req: UpdateFeedRequest) {
    this.updates.push([id, req]);
  }
}

describe("vault pipeline", () => {
  let root: string;
  let vaultDir: string;
  let workdir: string;
  const NOTE = "内容库/文章/2026-11-04-测试文章/index.md";
  const write = async (rel: string, data: string | Uint8Array) => {
    await mkdir(dirname(join(vaultDir, rel)), { recursive: true });
    await Bun.write(join(vaultDir, rel), data);
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "obsidian-publish-"));
    vaultDir = join(root, "vault");
    workdir = join(root, "work");
    await write(".obsidian/app.json", "{}");
    await write("内容库/文章/2026-11-04-测试文章/images/arch.svg", SVG);
    await write("内容库/文章/2026-11-04-测试文章/images/my pic.png", PNG);
    await write("附件/pasted.png", PNG);
    await write("内容库/文章/另一篇.md", "# 另一篇\n\n正文\n");
    await write(
      NOTE,
      [
        "---",
        "标签: [工作流, 博客]",
        "状态: 草稿",
        "---",
        "",
        "# 测试文章",
        "",
        "![架构](images/arch.svg)",
        "![[my pic.png|300]]",
        "![[pasted.png]]",
        "![](images/my%20pic.png)",
        "![外链](https://example.com/x.png)",
        "见 [[另一篇]]。",
        "",
      ].join("\n"),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds notes by path, folder or partial name", () => {
    const v = new Vault(vaultDir);
    expect(v.findNote("测试")).toBe(NOTE);
    expect(v.findNote(join(vaultDir, "内容库/文章/2026-11-04-测试文章"))).toBe(NOTE);
    expect(v.findNote("内容库/文章/另一篇.md")).toBe("内容库/文章/另一篇.md");
    expect(() => v.findNote("不存在")).toThrow("没有名字包含");
    expect(noteSlug(NOTE)).toBe("2026-11-04-测试文章");
    expect(v.files.some((f) => f.startsWith(".obsidian"))).toBe(false);
  });

  it.skipIf(!HAS_SIPS)("builds a bundle: title from H1, images localized, SVG rendered to PNG", async () => {
    const r = await buildBundle(new Vault(vaultDir), NOTE, { workdir, site: "https://blog.test" });
    expect(r.errors).toEqual([]);
    expect(r.meta.title).toBe("测试文章");
    expect(r.meta.tags).toEqual(["工作流", "博客"]);
    expect(r.markdown).not.toContain("# 测试文章");
    // same file referenced twice -> one image
    expect(r.meta.images.map((i) => [i.source, i.file])).toEqual([
      ["内容库/文章/2026-11-04-测试文章/images/arch.svg", "images/01.png"],
      ["内容库/文章/2026-11-04-测试文章/images/my pic.png", "images/02.png"],
      ["附件/pasted.png", "images/03.png"],
    ]);
    expect(r.markdown).toContain("![架构](images/01.png)");
    expect(r.markdown).toContain('<img src="images/02.png" alt="" width="300">');
    expect(r.markdown).toContain("![](images/02.png)");
    expect(r.markdown).toContain("见 另一篇。");
    expect(r.warnings.some((w) => w.includes("外链图片"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("草稿"))).toBe(true);
    if (process.platform === "darwin") {
      const png = new Uint8Array(await Bun.file(join(r.dir, "images/01.png")).arrayBuffer());
      expect(sniffImageType(png)).toBe("image/png");
      expect(png.length).toBeGreaterThan(0);
    }
    expect(await Bun.file(r.previewPath).text()).toContain("<h1>测试文章</h1>");
  });

  it("reports missing images as errors and refuses to publish", async () => {
    await write(NOTE, "# T\n\n![[nope.png]]\n![](images/missing.png)\n");
    const r = await buildBundle(new Vault(vaultDir), NOTE, { workdir });
    expect(r.errors).toEqual(["找不到图片：![[nope.png]]", "找不到图片：images/missing.png"]);
    await expect(publishNote(new Vault(vaultDir), NOTE, new FakeBlog(), { workdir, yes: true })).rejects.toThrow("检查未通过");
  });

  it.skipIf(!HAS_SIPS)("publishes, skips unchanged, updates on change, reuses uploads, recreates deleted posts", async () => {
    const blog = new FakeBlog();
    const vault = () => new Vault(vaultDir);

    const plan = await publishNote(vault(), NOTE, blog, { workdir });
    expect(plan.done).toBe(false);
    expect(plan.plan).toMatchObject({ action: "create", imagesToUpload: 3 });
    expect(blog.uploads).toEqual([]);

    const first = await publishNote(vault(), NOTE, blog, { workdir, yes: true });
    expect(first.done && first.url).toBe("https://blog.test/feed/101");
    expect(blog.uploads.length).toBe(3);
    const content = blog.creates[0]!.content;
    expect(content).toContain("![架构](https://img.test/1-01.png)");
    expect(content).not.toContain("images/");
    expect(blog.creates[0]).toMatchObject({ title: "测试文章", tags: ["工作流", "博客"], draft: false, listed: true });
    expect((await loadState(join(workdir, "state.json"))).notes[NOTE]?.feedId).toBe(101);

    const again = await publishNote(vault(), NOTE, blog, { workdir, yes: true });
    expect(again.plan.action).toBe("unchanged");

    await write(NOTE, (await Bun.file(join(vaultDir, NOTE)).text()) + "\n新增一段。\n");
    const updated = await publishNote(vault(), NOTE, blog, { workdir, yes: true });
    expect(updated.plan).toMatchObject({ action: "update", feedId: 101, imagesToUpload: 0 });
    expect(blog.uploads.length).toBe(3);
    expect(blog.updates[0]![1].content).toContain("新增一段");

    // links to a published note become blog links
    const other = await publishNote(vault(), "内容库/文章/另一篇.md", blog, { workdir, yes: true });
    expect(other.plan.feedId).toBe(102);
    await publishNote(vault(), NOTE, blog, { workdir, yes: true });
    expect(blog.updates.at(-1)![1].content).toContain("见 [另一篇](https://blog.test/feed/102)。");

    blog.feeds.delete(101);
    const recreated = await publishNote(vault(), NOTE, blog, { workdir, yes: true });
    expect(recreated.plan.action).toBe("create");
    expect(recreated.plan.feedId).toBe(103);
  });

  it.skipIf(!HAS_SIPS)("--feed-id links a note to an existing post", async () => {
    const blog = new FakeBlog();
    blog.feeds.set(7, { id: 7, title: "旧", draft: 0, listed: 1, content: "" });
    const r = await publishNote(new Vault(vaultDir), NOTE, blog, { workdir, yes: true, feedId: 7 });
    expect(r.plan).toMatchObject({ action: "update", feedId: 7 });
    await expect(publishNote(new Vault(vaultDir), NOTE, blog, { workdir, feedId: 999 })).rejects.toThrow("找不到文章 999");
  });
});
