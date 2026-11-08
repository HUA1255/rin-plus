import { homedir } from "node:os";
import { join } from "node:path";

/** Blog origin to publish to, e.g. https://blog.example.com. Defaults to the local dev server. */
export const BLOG_SITE = (process.env.RIN_SITE || "http://localhost:11498").replace(/\/+$/, "");

export const YUQUE_API = "https://www.yuque.com/api/v2";

/** Bundles and the doc -> post state file live outside the repo. */
export const WORKDIR = process.env.RIN_YUQUE_WORKDIR || join(homedir(), ".rin-publish", "yuque");

/** Must match MAX_UPLOAD_BYTES in server/src/utils/upload.ts. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Must match ALLOWED_UPLOAD_CONTENT_TYPES in server/src/utils/upload.ts (image subset). */
export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Hosts whose images are hotlink-protected and must be re-hosted on R2. */
export const YUQUE_IMAGE_HOST = /^https?:\/\/([^/]+\.)?(nlark\.com|yuque\.com|alipayobjects\.com)\//i;
