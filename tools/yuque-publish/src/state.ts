import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WORKDIR } from "./config";

/** Which blog post each Yuque doc was published to, so re-publishing updates instead of duplicating. */
export interface PublishRecord {
  namespace: string;
  slug: string;
  title: string;
  feedId: number;
  publishedAt: string;
  sourceUpdatedAt: string;
  contentSha256: string;
}

export interface PublishState {
  version: 1;
  docs: Record<string, PublishRecord>;
}

export function statePath(workdir = WORKDIR) {
  return join(workdir, "state.json");
}

export async function loadState(path = statePath()): Promise<PublishState> {
  const f = Bun.file(path);
  return (await f.exists()) ? ((await f.json()) as PublishState) : { version: 1, docs: {} };
}

export async function saveState(state: PublishState, path = statePath()) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(state, null, 2) + "\n");
}

export function sha256(data: string | Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}
