import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ARTICLES_DIR } from "./config";

const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);
const toPosix = (p: string) => p.split(sep).join("/");

/** All files in the vault (relative, posix-style), skipping Obsidian config and hidden folders. */
export class Vault {
  readonly files: string[] = [];

  constructor(readonly root: string) {
    if (!existsSync(root)) throw new Error(`找不到 Obsidian 库: ${root}（可用 OBSIDIAN_VAULT 指定）`);
    const walk = (dir: string) => {
      for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) walk(rel);
        else if (e.isFile()) this.files.push(rel);
      }
    };
    walk("");
    this.files.sort();
  }

  abs(rel: string) {
    return join(this.root, rel);
  }

  rel(abs: string) {
    return toPosix(relative(this.root, abs));
  }

  /**
   * Resolve a link the way Obsidian does: exact vault path, then relative to the note,
   * then by file name anywhere in the vault (closest to the note wins).
   * `name` may omit the .md extension for notes.
   */
  resolveLink(name: string, fromNote: string): string | null {
    const clean = name.replace(/^\/+/, "");
    const candidates = extname(clean) ? [clean] : [clean, clean + ".md"];
    for (const c of candidates) {
      if (this.files.includes(c)) return c;
      const fromDir = toPosix(join(dirname(fromNote), c));
      if (this.files.includes(fromDir)) return fromDir;
    }
    const base = candidates.map((c) => basename(c).toLowerCase());
    const hits = this.files.filter((f) => base.includes(basename(f).toLowerCase()));
    if (!hits.length) return null;
    const noteDir = dirname(fromNote);
    const score = (f: string) => (dirname(f) === noteDir ? 0 : dirname(f).startsWith(noteDir) ? 1 : 2) * 1000 + f.length;
    return hits.sort((a, b) => score(a) - score(b))[0]!;
  }

  /** Publishable notes under ARTICLES_DIR: <dir>/<article>/index.md or <dir>/<article>.md */
  articles(dir = ARTICLES_DIR): string[] {
    return this.files.filter((f) => f.startsWith(dir + "/") && f.endsWith(".md"));
  }

  /**
   * Turn a CLI argument into a note path (relative to the vault):
   * a path to a .md file or a folder holding index.md, or part of an article name.
   */
  findNote(arg: string): string {
    for (const p of [resolve(arg), isAbsolute(arg) ? arg : join(this.root, arg)]) {
      if (!existsSync(p)) continue;
      const file = statSync(p).isDirectory() ? join(p, "index.md") : p;
      if (!file.endsWith(".md") || !existsSync(file)) throw new Error(`不是 Markdown 笔记: ${p}`);
      const rel = this.rel(file);
      if (rel.startsWith("..")) throw new Error(`笔记不在 Obsidian 库里: ${file}`);
      return rel;
    }
    const needle = arg.toLowerCase();
    const match = (list: string[]) => list.filter((f) => noteSlug(f).toLowerCase().includes(needle));
    let hits = match(this.articles());
    if (!hits.length) hits = match(this.files.filter((f) => f.endsWith(".md")));
    if (hits.length === 1) return hits[0]!;
    if (!hits.length) throw new Error(`库里没有名字包含「${arg}」的笔记`);
    throw new Error(`「${arg}」匹配到多篇笔记，请写得更具体：\n  ${hits.join("\n  ")}`);
  }
}

/** Article name: the folder name for <folder>/index.md, else the file name without .md. */
export function noteSlug(notePath: string): string {
  const name = basename(notePath, ".md");
  return name.toLowerCase() === "index" && dirname(notePath) !== "." ? basename(dirname(notePath)) : name;
}
