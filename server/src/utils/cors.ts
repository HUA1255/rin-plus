const CORS_ALLOW_METHODS = "GET, POST, PUT, DELETE, PATCH, OPTIONS";
const CORS_ALLOW_HEADERS = "content-type, authorization";
const CORS_MAX_AGE = "600";

/** Cross-origin requests are allowed only from FRONTEND_URL; same-origin requests need no CORS. */
export function getAllowedOrigins(env?: { FRONTEND_URL?: string }): Set<string> {
    const origins = new Set<string>();
    const frontendUrl = env?.FRONTEND_URL?.trim().replace(/\/+$/, "");
    if (frontendUrl) {
        origins.add(frontendUrl);
    }
    return origins;
}

export function isAllowedOrigin(origin: string | undefined | null, env?: { FRONTEND_URL?: string }): origin is string {
    if (!origin) {
        return false;
    }
    return getAllowedOrigins(env).has(origin);
}

export function buildCorsHeaders(origin: string): Record<string, string> {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
        "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
        "Access-Control-Max-Age": CORS_MAX_AGE,
        Vary: "Origin",
    };
}
