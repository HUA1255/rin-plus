import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Blog origin to publish to, e.g. https://blog.example.com. Defaults to the local dev server. */
export const BLOG_SITE = (process.env.RIN_SITE || "http://localhost:11498").replace(/\/+$/, "");

/** Bundles and the note -> post state file live outside the repo. */
export const WORKDIR = process.env.RIN_OBSIDIAN_WORKDIR || join(homedir(), ".rin-publish", "obsidian");

/** Folder inside the vault that `list` and name lookup search first. */
export const ARTICLES_DIR = process.env.OBSIDIAN_ARTICLES_DIR || "内容库/文章";

/** Must match MAX_UPLOAD_BYTES in server/src/utils/upload.ts. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Must match ALLOWED_UPLOAD_CONTENT_TYPES in server/src/utils/upload.ts. */
export const UPLOAD_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

/** Image files Obsidian notes may embed; .svg is rendered to PNG before upload. */
export const IMAGE_EXTS = new Set([...Object.keys(UPLOAD_TYPES), ".svg"]);

/**
 * Vault path: OBSIDIAN_VAULT, else the vault Obsidian has open
 * (~/Library/Application Support/obsidian/obsidian.json), else ~/Documents/Obsidian.
 */
export function defaultVault(): string {
  if (process.env.OBSIDIAN_VAULT) return process.env.OBSIDIAN_VAULT;
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), "Library/Application Support/obsidian/obsidian.json"), "utf8")) as {
      vaults?: Record<string, { path: string; ts?: number; open?: boolean }>;
    };
    const vaults = Object.values(cfg.vaults ?? {}).filter((v) => existsSync(v.path));
    const pick = vaults.find((v) => v.open) ?? vaults.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))[0];
    if (pick) return pick.path;
  } catch {
    // fall through
  }
  return join(homedir(), "Documents", "Obsidian");
}
