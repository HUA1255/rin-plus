export const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif",
]);

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function normalizeAllowedContentType(raw: string | undefined | null): string | null {
    const base = (raw || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(base)) {
        return null;
    }
    return base;
}

export function safeBlobContentType(raw: string | undefined | null): string {
    return normalizeAllowedContentType(raw) ?? "application/octet-stream";
}
