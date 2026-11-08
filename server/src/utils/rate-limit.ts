type RateLimitBucket = {
    count: number;
    resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

export type RateLimitResult = {
    allowed: boolean;
    retryAfterSec: number;
};

export type RateLimitOptions = {
    name: string;
    key: string;
    limit: number;
    windowMs: number;
};

export function resetRateLimitStore() {
    buckets.clear();
}

export function consumeRateLimit(options: RateLimitOptions): RateLimitResult {
    try {
        const now = Date.now();
        const storeKey = `${options.name}:${options.key || "unknown"}`;
        const existing = buckets.get(storeKey);

        if (!existing || existing.resetAt <= now) {
            buckets.set(storeKey, { count: 1, resetAt: now + options.windowMs });
            return { allowed: true, retryAfterSec: Math.ceil(options.windowMs / 1000) };
        }

        if (existing.count >= options.limit) {
            return {
                allowed: false,
                retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
            };
        }

        existing.count += 1;
        return { allowed: true, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
    } catch {
        return { allowed: false, retryAfterSec: 60 };
    }
}

export function getClientRateLimitKey(headers: { get(name: string): string | null | undefined }): string {
    const cfIp = headers.get("cf-connecting-ip");
    if (cfIp) {
        return cfIp.trim();
    }
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
        return forwarded.split(",")[0]?.trim() || "unknown";
    }
    const realIp = headers.get("x-real-ip");
    if (realIp) {
        return realIp.trim();
    }
    return "unknown";
}
