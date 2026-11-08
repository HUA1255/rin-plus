import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { WORKDIR } from "./config";

/**
 * A bundle is one doc prepared for publishing, all on local disk:
 *   <WORKDIR>/bundles/<slug>/post.md      cleaned markdown, images as images/NN.ext
 *   <WORKDIR>/bundles/<slug>/images/      localized images
 *   <WORKDIR>/bundles/<slug>/meta.json    BundleMeta
 *   <WORKDIR>/bundles/<slug>/preview.html written by `check`
 */
export interface BundleImage {
  index: number;
  sourceUrl: string;
  /** Path relative to the bundle dir, null while the image is missing. */
  file: string | null;
  bytes?: number;
  contentType?: string;
  /** Public R2 URL after upload; reused on re-publish. */
  uploadedUrl?: string;
  uploadedSha256?: string;
}

export interface BundleMeta {
  version: 1;
  source: { namespace: string; slug: string; docId: number; updatedAt: string };
  title: string;
  tags: string[];
  alias?: string;
  fetchedAt: string;
  images: BundleImage[];
}

export function bundleDir(slug: string, workdir = WORKDIR) {
  return join(workdir, "bundles", slug);
}

export async function writeBundle(dir: string, meta: BundleMeta, markdown: string) {
  await mkdir(join(dir, "images"), { recursive: true });
  await Bun.write(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  await Bun.write(join(dir, "post.md"), markdown);
}

export async function readBundle(dir: string): Promise<{ meta: BundleMeta; markdown: string }> {
  const metaFile = Bun.file(join(dir, "meta.json"));
  if (!(await metaFile.exists())) throw new Error(`不是文章包目录（缺 meta.json）: ${dir}`);
  return {
    meta: (await metaFile.json()) as BundleMeta,
    markdown: await Bun.file(join(dir, "post.md")).text(),
  };
}

export async function saveMeta(dir: string, meta: BundleMeta) {
  await Bun.write(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
}
