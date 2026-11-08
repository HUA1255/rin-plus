const SCRIPT_LIKE = /<\/?(script|iframe|object|embed|link|meta|style)[^>]*>/gi;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const UNSAFE_URL = /^(javascript|data|vbscript):/i;

export function stripRawHtml(markdown: string): string {
    return markdown
        .replace(SCRIPT_LIKE, "")
        .replace(HTML_TAG, "");
}

export function sanitizeMarkdownLink(url: string): string {
    const trimmed = url.trim();
    if (!trimmed || UNSAFE_URL.test(trimmed)) {
        return "";
    }
    return trimmed;
}

export function sanitizeStoredMarkdown(markdown: string): string {
    const withoutHtml = stripRawHtml(markdown);
    return withoutHtml.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
        const safe = sanitizeMarkdownLink(url);
        if (!safe) {
            return label;
        }
        return `[${label}](${safe})`;
    }).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, url: string) => {
        const safe = sanitizeMarkdownLink(url);
        if (!safe) {
            return alt;
        }
        return `![${alt}](${safe})`;
    });
}

export function looksLikeUnsafeMarkdown(markdown: string): boolean {
    return SCRIPT_LIKE.test(markdown) || /on\w+\s*=/.test(markdown);
}
