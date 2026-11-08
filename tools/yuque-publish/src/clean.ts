/**
 * Clean Yuque "lake" markdown so it renders well in the blog
 * (react-markdown + rehype-raw, light and dark themes).
 */

const HTML_TAGS = new Set(
  `a abbr b blockquote br code del details div em figcaption figure font h1 h2 h3 h4 h5 h6 hr i img ins
   kbd li mark ol p pre q s small span strong sub summary sup table tbody td th thead tr u ul video audio
   source iframe center`.split(/\s+/),
);

/** Near-black text colors are Yuque's default; keeping them breaks dark mode. */
export function isNeutralColor(value: string): boolean {
  const v = value.trim().toLowerCase().replace(/\s+/g, "");
  const rgb = v.match(/^rgba?\((\d+),(\d+),(\d+)/);
  if (rgb) return rgb.slice(1, 4).every((x) => Number(x) <= 64);
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return [0, 2, 4].every((i) => parseInt(h.slice(i, i + 2), 16) <= 64);
  }
  return ["black", "inherit", "initial", "currentcolor"].includes(v);
}

function convertFonts(text: string): string {
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<font\b([^>]*)>([\s\S]*?)<\/font>/g, (_m, attrs: string, inner: string) => {
      const style = attrs.match(/style="([^"]*)"/)?.[1] ?? "";
      const color = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/)?.[1]?.trim();
      return color && !isNeutralColor(color) ? `<span style="color:${color}">${inner}</span>` : inner;
    });
  } while (text !== prev); // nested <font> unwrap layer by layer
  return text;
}

/** `<Agent账号>` would be swallowed as an unknown tag by rehype-raw. */
function escapeUnknownTags(text: string): string {
  return text.replace(/<(\/?)([^\s<>/!]+)([^<>]*)>/g, (m, _slash, name: string) =>
    HTML_TAGS.has(name.toLowerCase()) ? m : `&lt;${m.slice(1, -1)}&gt;`,
  );
}

function cleanProse(text: string): string {
  text = text.replace(/<a name="[^"]*"><\/a>/g, "");
  text = convertFonts(text);
  return escapeUnknownTags(text);
}

/** Apply fn only outside fenced code blocks and inline code spans. */
export function mapOutsideCode(markdown: string, fn: (prose: string) => string): string {
  const out: string[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (buf.length) out.push(mapOutsideInlineCode(buf.join("\n"), fn));
    buf = [];
  };
  for (const line of markdown.split("\n")) {
    const opener = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (fence === null && opener) {
      flush();
      fence = opener;
      out.push(line);
    } else if (fence !== null) {
      out.push(line);
      if (line.trimStart().startsWith(fence)) fence = null;
    } else {
      buf.push(line);
    }
  }
  flush();
  return out.join("\n");
}

function mapOutsideInlineCode(text: string, fn: (prose: string) => string): string {
  return text
    .split(/(`+[^`\n]*?`+)/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

export function cleanBody(body: string): string {
  return mapOutsideCode(body.replace(/\r\n/g, "\n"), cleanProse).trim() + "\n";
}
