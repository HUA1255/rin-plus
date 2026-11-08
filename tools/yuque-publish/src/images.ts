import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_TYPES, MAX_UPLOAD_BYTES, YUQUE_IMAGE_HOST } from "./config";
import type { BundleImage } from "./bundle";
import type { Fetch } from "./yuque";

const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(\s+"[^"]*")?\s*\)/g;
const HTML_IMAGE = /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi;

/** Rewrite every image URL in markdown (both ![]() and <img src>). */
export function rewriteImageUrls(markdown: string, map: (url: string) => string): string {
  return markdown
    .replace(MD_IMAGE, (_m, alt: string, url: string, title = "") => `![${alt}](${map(url)}${title})`)
    .replace(HTML_IMAGE, (_m, pre: string, url: string, post: string) => pre + map(url) + post);
}

export function extractImageUrls(markdown: string): string[] {
  const urls: string[] = [];
  rewriteImageUrls(markdown, (u) => (urls.push(u), u));
  return [...new Set(urls)];
}

/** Detect the real type from magic bytes; a hotlink block often returns HTML with status 200. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}

const EXT_BY_TYPE: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
const pad = (n: number) => String(n).padStart(2, "0");

async function findIndexed(dir: string, index: number): Promise<string | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.find((n) => n.startsWith(pad(index) + ".") && n.slice(n.lastIndexOf(".")).toLowerCase() in IMAGE_TYPES) ?? null;
}

async function download(http: Fetch, url: string): Promise<Uint8Array> {
  const res = await http(url.split("#")[0]!, {
    headers: {
      Referer: "https://www.yuque.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Shrink oversized PNG/JPEG/WebP to JPEG with macOS `sips`. */
async function shrink(path: string): Promise<string> {
  const out = path.replace(/\.[^.]+$/, ".jpg");
  const tmp = out + ".tmp.jpg";
  const proc = Bun.spawn(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", "2400", path, "--out", tmp], {
    stdout: "ignore",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) throw new Error(`sips 压缩失败: ${await new Response(proc.stderr).text()}`);
  if (out !== path) await rm(path);
  await Bun.write(out, Bun.file(tmp));
  await rm(tmp);
  return out;
}

export interface LocalizeOptions {
  http?: Fetch;
  /** Directory with images saved by hand, named 01.png, 02.jpg, ... in document order. */
  manualDir?: string;
  /** Skip network downloads (only use existing/manual files). */
  offline?: boolean;
}

export interface LocalizeResult {
  markdown: string;
  images: BundleImage[];
  failures: Array<{ index: number; url: string; error: string }>;
}

/**
 * Make every Yuque-hosted image a local file under <dir>/images/NN.ext.
 * Order of preference: file already in the bundle > manualDir > download with Referer.
 * Images that cannot be obtained keep their source URL and are reported in `failures`.
 */
export async function localizeImages(markdown: string, dir: string, opts: LocalizeOptions = {}): Promise<LocalizeResult> {
  const http = opts.http ?? fetch;
  const imgDir = join(dir, "images");
  await mkdir(imgDir, { recursive: true });
  const sources = extractImageUrls(markdown).filter((u) => YUQUE_IMAGE_HOST.test(u));
  const images: BundleImage[] = [];
  const failures: LocalizeResult["failures"] = [];
  const local = new Map<string, string>();

  for (const [i, url] of sources.entries()) {
    const index = i + 1;
    try {
      let name = await findIndexed(imgDir, index);
      if (!name && opts.manualDir) {
        const manual = await findIndexed(opts.manualDir, index);
        if (manual) {
          await copyFile(join(opts.manualDir, manual), join(imgDir, manual));
          name = manual;
        }
      }
      if (!name) {
        if (opts.offline) throw new Error("本地没有这张图，且处于离线模式");
        const bytes = await download(http, url);
        const type = sniffImageType(bytes);
        if (!type) throw new Error("下载内容不是图片（可能被防盗链拦截）");
        name = pad(index) + EXT_BY_TYPE[type];
        await Bun.write(join(imgDir, name), bytes);
      }
      let path = join(imgDir, name);
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      let type = sniffImageType(bytes);
      if (!type) throw new Error(`${name} 不是有效图片`);
      if (bytes.length > MAX_UPLOAD_BYTES && type !== "image/gif") {
        path = await shrink(path);
        type = "image/jpeg";
      }
      const file = `images/${path.slice(imgDir.length + 1)}`;
      local.set(url, file);
      images.push({ index, sourceUrl: url, file, bytes: Bun.file(path).size, contentType: type });
    } catch (e) {
      failures.push({ index, url, error: (e as Error).message });
      images.push({ index, sourceUrl: url, file: null });
    }
  }

  return { markdown: rewriteImageUrls(markdown, (u) => local.get(u) ?? u), images, failures };
}
