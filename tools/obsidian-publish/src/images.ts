import { copyFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { MAX_UPLOAD_BYTES } from "./config";

/** Detect the real type from magic bytes. */
export function sniffImageType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  const brand = new TextDecoder().decode(b.slice(4, 12));
  if (brand === "ftypavif" || brand === "ftypavis") return "image/avif";
  return null;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

async function sips(args: string[]) {
  const proc = Bun.spawn(["sips", ...args], { stdout: "ignore", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new Error(`sips 失败: ${(await new Response(proc.stderr).text()).trim()}`);
}

/**
 * Render an SVG to PNG at 2x with macOS `sips` (the blog only accepts raster uploads).
 * The root <svg> width/height are doubled on a temp copy so text stays sharp on retina screens.
 */
export async function svgToPng(svgPath: string, outPng: string) {
  const svg = await Bun.file(svgPath).text();
  const root = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) throw new Error("不是有效的 SVG");
  const num = (attr: string) => Number(root.match(new RegExp(`\\s${attr}="([\\d.]+)(?:px)?"`))?.[1]);
  const vb = root.match(/viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/);
  const w = num("width") || Number(vb?.[1]);
  const h = num("height") || Number(vb?.[2]);
  let scaled = root;
  if (w && h) {
    scaled = root.replace(/\s(width|height)="[^"]*"/g, "");
    scaled = scaled.replace(/^<svg\b/i, `<svg width="${w * 2}" height="${h * 2}"`);
    if (!vb) scaled = scaled.replace(/^<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }
  const tmp = outPng + ".tmp.svg";
  await Bun.write(tmp, svg.replace(root, scaled));
  try {
    await sips(["-s", "format", "png", tmp, "--out", outPng]);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Shrink oversized PNG/JPEG/WebP to JPEG. Returns the new path. */
async function shrink(path: string): Promise<string> {
  const out = path.replace(/\.[^.]+$/, ".jpg");
  const tmp = out + ".tmp.jpg";
  await sips(["-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", "2400", path, "--out", tmp]);
  if (out !== path) await rm(path);
  await Bun.write(out, Bun.file(tmp));
  await rm(tmp);
  return out;
}

export interface PreparedImage {
  /** File name inside <bundle>/images/ */
  name: string;
  bytes: number;
  contentType: string;
  sha256: string;
}

/**
 * Copy one vault image into <imgDir>/NN.ext, converting it into something the blog accepts:
 * SVG -> PNG, oversized raster -> JPEG (<= 5MB).
 */
export async function prepareImage(src: string, imgDir: string, index: number): Promise<PreparedImage> {
  const stem = join(imgDir, String(index).padStart(2, "0"));
  let path: string;
  if (extname(src).toLowerCase() === ".svg") {
    path = stem + ".png";
    await svgToPng(src, path);
  } else {
    const head = new Uint8Array(await Bun.file(src).slice(0, 16).arrayBuffer());
    const type = sniffImageType(head);
    if (!type) throw new Error("文件内容不是博客支持的图片格式（png/jpg/gif/webp/avif/svg）");
    path = stem + EXT_BY_TYPE[type];
    await copyFile(src, path);
  }
  let type = sniffImageType(new Uint8Array(await Bun.file(path).slice(0, 16).arrayBuffer()))!;
  if (Bun.file(path).size > MAX_UPLOAD_BYTES) {
    if (type === "image/gif") throw new Error("GIF 超过 5MB 上传上限，请先压缩");
    path = await shrink(path);
    type = "image/jpeg";
  }
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return {
    name: path.slice(imgDir.length + 1),
    bytes: bytes.length,
    contentType: type,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  };
}
