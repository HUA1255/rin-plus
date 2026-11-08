import type { CreateFeedRequest, UpdateFeedRequest } from "@rin/api";
import { BLOG_SITE } from "./config";
import type { Fetch } from "./yuque";

export interface BlogFeedSummary {
  id: number;
  title: string | null;
  draft: number;
  listed: number;
}

/** Thin client for the Rin blog API (server/src/services/{auth,storage,feed}.ts). */
export class BlogClient {
  private token: string | null = null;

  constructor(
    private site: string = BLOG_SITE,
    private http: Fetch = fetch,
  ) {}

  private async call(method: string, path: string, body?: BodyInit, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { "User-Agent": "rin-yuque-publish/0.1", ...headers };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return this.http(this.site + path, { method, body, headers: h, signal: AbortSignal.timeout(60_000) });
  }

  private async fail(res: Response, what: string): Promise<never> {
    throw new Error(`${what}失败 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  async login(username: string, password: string) {
    const res = await this.call("POST", "/api/auth/login", JSON.stringify({ username, password }), {
      "Content-Type": "application/json",
    });
    if (!res.ok) await this.fail(res, "登录");
    const data = (await res.json()) as { success?: boolean; token?: string };
    if (!data.success || !data.token) throw new Error("登录失败：响应里没有 token");
    this.token = data.token;
  }

  async uploadImage(bytes: Uint8Array<ArrayBuffer>, filename: string, contentType: string): Promise<string> {
    const form = new FormData();
    form.append("file", new File([bytes], filename, { type: contentType }));
    form.append("key", filename);
    const res = await this.call("POST", "/api/storage", form);
    if (!res.ok) await this.fail(res, `上传图片 ${filename} `);
    const { url } = (await res.json()) as { url?: string };
    if (!url) throw new Error(`上传图片 ${filename} 后没有返回 URL`);
    return url;
  }

  /** Returns null when the post no longer exists. Needs login to see drafts. */
  async getFeed(id: number): Promise<BlogFeedSummary | null> {
    const res = await this.call("GET", `/api/feed/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, `读取文章 ${id} `);
    return (await res.json()) as BlogFeedSummary;
  }

  async createFeed(req: CreateFeedRequest): Promise<number> {
    const res = await this.call("POST", "/api/feed", JSON.stringify(req), { "Content-Type": "application/json" });
    if (!res.ok) {
      const text = await res.text();
      if (text.includes("Content already exists")) {
        throw new Error("博客里已有同标题同内容的文章。若要更新那篇，请加 --feed-id <文章ID>");
      }
      throw new Error(`发布文章失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const { insertedId } = (await res.json()) as { insertedId?: number };
    if (typeof insertedId !== "number") throw new Error("发布后没有返回文章 ID");
    return insertedId;
  }

  async updateFeed(id: number, req: UpdateFeedRequest): Promise<void> {
    const res = await this.call("POST", `/api/feed/${id}`, JSON.stringify(req), { "Content-Type": "application/json" });
    if (!res.ok) await this.fail(res, `更新文章 ${id} `);
  }

  postUrl(id: number) {
    return `${this.site}/feed/${id}`;
  }
}
