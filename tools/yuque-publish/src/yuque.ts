import { YUQUE_API } from "./config";

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface YuqueDoc {
  id: number;
  slug: string;
  title: string;
  body: string;
  format: string | null;
  tags: string[];
  updatedAt: string;
}

export interface DocRef {
  namespace: string;
  slug: string | null;
}

/** https://www.yuque.com/<login>/<repo>[/<slug>] -> { namespace, slug } */
export function parseYuqueUrl(url: string): DocRef {
  const m = url.match(/yuque\.com\/([^?#]+)/);
  if (!m) throw new Error(`无法解析语雀 URL: ${url}`);
  const parts = m[1]!.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`URL 需要包含 用户/知识库[/文档]: ${url}`);
  return { namespace: `${parts[0]}/${parts[1]}`, slug: parts[2] ?? null };
}

export class YuqueClient {
  constructor(
    private token: string,
    private http: Fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await this.http(YUQUE_API + path, {
      headers: { "X-Auth-Token": this.token, "User-Agent": "rin-yuque-publish/0.1" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`语雀 API ${path} 返回 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return ((await res.json()) as { data: T }).data;
  }

  user() {
    return this.get<{ login: string; name: string }>("/user");
  }

  async listDocs(namespace: string) {
    const docs: Array<{ slug: string; title: string; updated_at: string; public: number }> = [];
    // The docs endpoint pages with offset/limit (max 100).
    for (let offset = 0; ; offset += 100) {
      const page = await this.get<typeof docs>(`/repos/${namespace}/docs?offset=${offset}&limit=100`);
      docs.push(...page);
      if (page.length < 100) return docs;
    }
  }

  async getDoc(namespace: string, slug: string): Promise<YuqueDoc> {
    const d = await this.get<any>(`/repos/${namespace}/docs/${slug}`);
    return {
      id: d.id,
      slug: d.slug ?? slug,
      title: d.title ?? "",
      body: d.body ?? "",
      format: d.format ?? null,
      tags: ((d.tags ?? []) as unknown[])
        .map((t) => (typeof t === "string" ? t : (t as { title?: string })?.title ?? ""))
        .filter(Boolean),
      updatedAt: d.content_updated_at ?? d.updated_at ?? "",
    };
  }
}
