// Platforms shown on the homepage profile. Order here is display order.
// To add a platform: add an entry here, a config default in packages/config,
// a settings input, and translations for `home.social.<id>`.

export const SOCIAL_PLATFORMS = [
    { id: "xiaohongshu", configKey: "social.xiaohongshu", kind: "link", color: "#ff2442" },
    { id: "bilibili", configKey: "social.bilibili", kind: "link", color: "#00a1d6", icon: "ri-bilibili-fill" },
    { id: "github", configKey: "social.github", kind: "link", color: "", icon: "ri-github-fill" },
    { id: "wechat", configKey: "social.wechat_qr", kind: "qr", color: "#07c160", icon: "ri-wechat-fill" },
    { id: "email", configKey: "social.email", kind: "email", color: "", icon: "ri-mail-line" },
] as const;

export type SocialPlatformId = (typeof SOCIAL_PLATFORMS)[number]["id"] | "rss";

export type SocialLink = {
    id: SocialPlatformId;
    kind: "link" | "qr" | "email";
    color: string;
    icon?: string;
    /** Link target for kind "link"; QR image URL for "qr"; plain address for "email". */
    value: string;
};

export function normalizeSocialUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith("/")) return trimmed;
    // Any other scheme (javascript:, vbscript:, ...) is rejected rather than linked.
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return "";
    return `https://${trimmed}`;
}

export function normalizeEmail(value: string): string {
    return value.trim().replace(/^mailto:/i, "");
}

/** Build the visible social links from config. Empty values are hidden. */
export function resolveSocialLinks(get: (key: string) => unknown, rssEnabled: boolean): SocialLink[] {
    const links: SocialLink[] = [];
    for (const platform of SOCIAL_PLATFORMS) {
        const raw = String(get(platform.configKey) ?? "").trim();
        if (!raw) continue;
        const value = platform.kind === "email" ? normalizeEmail(raw) : normalizeSocialUrl(raw);
        if (!value) continue;
        links.push({
            id: platform.id,
            kind: platform.kind,
            color: platform.color,
            icon: "icon" in platform ? platform.icon : undefined,
            value,
        });
    }
    if (rssEnabled) {
        links.push({ id: "rss", kind: "link", color: "#f08a24", icon: "ri-rss-fill", value: "/rss.xml" });
    }
    return links;
}
