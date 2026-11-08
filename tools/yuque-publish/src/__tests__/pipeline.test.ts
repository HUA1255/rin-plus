import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateFeedRequest, UpdateFeedRequest } from "@rin/api";
import { BlogClient, type BlogFeedSummary } from "../blog";
import { readBundle } from "../bundle";
import { extractImageUrls, rewriteImageUrls, sniffImageType } from "../images";
import { checkBundle, fetchBundle, publishBundle } from "../pipeline";
import { loadState } from "../state";
import { parseYuqueUrl, YuqueClient, type YuqueDoc } from "../yuque";

// 1x1 PNG
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);
const IMG_A = "https://cdn.nlark.com/yuque/0/2026/png/1/a.png#averageHue=%23fff";
const IMG_B = "https://cdn.nlark.com/yuque/0/2026/png/1/b.png";

class FakeYuque extends YuqueClient {
  constructor(public doc: YuqueDoc) {
    super("token");
  }
  override async getDoc() {
    return this.doc;
  }
}

class FakeBlog extends BlogClient {
  feeds = new Map<number, BlogFeedSummary & { content: string }>();
  uploads: string[] = [];
  creates = 0;
  updates: Array<[number, UpdateFeedRequest]> = [];
  constructor() {
    super("https://blog.test");
  }
  override async uploadImage(_b: Uint8Array<ArrayBuffer>, filename: string) {
    this.uploads.push(filename);
    return `https://img.test/images/${filename}`;
  }
  override async getFeed(id: number) {
    return this.feeds.get(id) ?? null;
  }
  override async createFeed(req: CreateFeedRequest) {
    const id = 100 + ++this.creates;
    this.feeds.set(id, { id, title: req.title, draft: req.draft ? 1 : 0, listed: 1, content: req.content });
    return id;
  }
  override async updateFeed(id: number, req: UpdateFeedRequest) {
    this.updates.push([id, req]);
  }
}

const doc = (body: string): YuqueDoc => ({
  id: 42,
  slug: "abc",
  title: "测试文章",
  body,
  format: "lake",
  tags: ["agent"],
  updatedAt: "2026-11-03T00:00:00Z",
});

const imageHttp = (blocked = new Set<string>()) =>
  (async (input: string | URL | Request) => {
    const url = String(input);
    if (blocked.has(url)) return new Response("<html>forbidden</html>", { status: 200 });
    return new Response(PNG, { headers: { "Content-Type": "image/png" } });
  }) as typeof fetch;

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "yuque-publish-"));
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("helpers", () => {
  it("parses doc and repo URLs", () => {
    expect(parseYuqueUrl("https://www.yuque.com/u1/repo/slug?x=1")).toEqual({ namespace: "u1/repo", slug: "slug" });
    expect(parseYuqueUrl("https://www.yuque.com/u1/repo")).toEqual({ namespace: "u1/repo", slug: null });
  });
  it("finds markdown and html images, keeps titles", () => {
    const md = `![a](${IMG_B} "t") <img src="${IMG_A}">`;
    expect(extractImageUrls(md)).toEqual([IMG_B, IMG_A]);
    expect(rewriteImageUrls(md, () => "x.png")).toBe('![a](x.png "t") <img src="x.png">');
  });
  it("sniffs real image bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
  });
});

describe("fetch -> check", () => {
  it("localizes Yuque images and passes check", async () => {
    const { dir, failures } = await fetchBundle(new FakeYuque(doc(`前\n\n![](${IMG_A})\n\n![](${IMG_B})`)), "u/r", "abc", {
      http: imageHttp(),
      workdir: work,
    });
    expect(failures).toEqual([]);
    const { markdown, meta } = await readBundle(dir);
    expect(markdown).toContain("![](images/01.png)");
    expect(markdown).toContain("![](images/02.png)");
    expect(meta.images.map((i) => i.file)).toEqual(["images/01.png", "images/02.png"]);
    const report = await checkBundle(dir);
    expect(report.errors).toEqual([]);
    expect(await Bun.file(report.previewPath).text()).toContain('src="images/01.png"');
  });

  it("fails check when an image is hotlink-blocked, then accepts a manual file", async () => {
    const yuque = new FakeYuque(doc(`![](${IMG_A})`));
    const first = await fetchBundle(yuque, "u/r", "abc", { http: imageHttp(new Set([IMG_A.split("#")[0]!])), workdir: work });
    expect(first.failures[0]?.error).toContain("不是图片");
    expect((await checkBundle(first.dir)).errors.join()).toContain("图片 01 没有本地文件");

    const manual = join(work, "manual");
    await Bun.write(join(manual, "01.png"), PNG);
    const second = await fetchBundle(yuque, "u/r", "abc", { manualDir: manual, offline: true, workdir: work });
    expect(second.failures).toEqual([]);
    expect((await checkBundle(second.dir)).errors).toEqual([]);
  });

  it("drops a local file when its position now holds a different image", async () => {
    const yuque = new FakeYuque(doc(`![](${IMG_A})`));
    await fetchBundle(yuque, "u/r", "abc", { http: imageHttp(), workdir: work });
    yuque.doc = doc(`![](${IMG_B})`);
    const { failures } = await fetchBundle(yuque, "u/r", "abc", { offline: true, workdir: work });
    expect(failures).toHaveLength(1); // stale 01.png was not reused for a different image
  });
});

describe("publish", () => {
  it("plans without writing, then creates, then updates or skips", async () => {
    const yuque = new FakeYuque(doc(`正文\n\n![](${IMG_A})`));
    const { dir } = await fetchBundle(yuque, "u/r", "abc", { http: imageHttp(), workdir: work });
    const blog = new FakeBlog();
    const statePath = join(work, "state.json");

    const plan = await publishBundle(dir, blog, { statePath });
    expect(plan.done).toBe(false);
    expect(plan.plan).toMatchObject({ action: "create", imagesToUpload: 1, draft: false, listed: true });
    expect(blog.uploads).toEqual([]);

    const created = await publishBundle(dir, blog, { statePath, yes: true });
    expect(created.done).toBe(true);
    expect(blog.feeds.get(101)?.content).toContain("![](https://img.test/images/01.png)");
    expect((await loadState(statePath)).docs["42"]?.feedId).toBe(101);

    const same = await publishBundle(dir, blog, { statePath, yes: true });
    expect(same.plan.action).toBe("unchanged");
    expect(blog.updates).toEqual([]);

    yuque.doc = doc(`改过的正文\n\n![](${IMG_A})`);
    await fetchBundle(yuque, "u/r", "abc", { offline: true, workdir: work });
    const updated = await publishBundle(dir, blog, { statePath, yes: true });
    expect(updated.plan).toMatchObject({ action: "update", feedId: 101, imagesToUpload: 0 });
    expect(blog.updates[0]?.[1].content).toContain("改过的正文");
    expect(blog.uploads).toEqual(["01.png"]); // image uploaded once
  });

  it("refuses to publish a bundle that fails check", async () => {
    const { dir } = await fetchBundle(new FakeYuque(doc(`![](${IMG_A})`)), "u/r", "abc", { offline: true, workdir: work });
    await expect(publishBundle(dir, new FakeBlog(), { statePath: join(work, "s.json"), yes: true })).rejects.toThrow("检查未通过");
  });
});
