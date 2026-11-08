const DISABLED_VALUES = new Set(["", "false", "0", "no", "off"]);
const ENABLED_VALUES = new Set(["true", "1", "yes", "on"]);

export function isRssEnabled(env: { RSS_ENABLE?: string }): boolean {
    const raw = env.RSS_ENABLE;
    if (raw === undefined || raw === null) {
        return true;
    }
    const normalized = String(raw).trim().toLowerCase();
    if (DISABLED_VALUES.has(normalized)) {
        return false;
    }
    return ENABLED_VALUES.has(normalized);
}
