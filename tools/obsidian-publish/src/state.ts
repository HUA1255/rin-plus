import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WORKDIR } from "./config";

/** Which blog post each note was published to, so re-publishing updates instead of duplicating. */
export interface PublishRecord {
  title: string;
  feedId: number;
  publishedAt: string;
  contentSha256: string;
}

export interface PublishState {
  version: 1;
  /** Keyed by the note's path relative to the vault, e.g. 内容库/文章/xxx/index.md */
  notes: Record<string, PublishRecord>;
}

export function statePath(workdir = WORKDIR) {
  return join(workdir, "state.json");
}

export async function loadState(path = statePath()): Promise<PublishState> {
  const f = Bun.file(path);
  return (await f.exists()) ? ((await f.json()) as PublishState) : { version: 1, notes: {} };
}

export async function saveState(state: PublishState, path = statePath()) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(state, null, 2) + "\n");
}

export function sha256(data: string | Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}
