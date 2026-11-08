const LEGACY_SHA256_HEX = /^[a-f0-9]{64}$/i;
const V2_PREFIX = "v2:hmac-sha256:";
const SALT_BYTES = 16;

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
    const normalized = hex.toLowerCase();
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

export function timingSafeEqualHex(left: string, right: string): boolean {
    const leftBytes = hexToBytes(left);
    const rightBytes = hexToBytes(right);
    if (leftBytes.length !== rightBytes.length) {
        let dummy = 0;
        for (let i = 0; i < leftBytes.length; i++) {
            dummy |= leftBytes[i] ^ leftBytes[i];
        }
        return dummy === -1;
    }
    let diff = 0;
    for (let i = 0; i < leftBytes.length; i++) {
        diff |= leftBytes[i] ^ rightBytes[i];
    }
    return diff === 0;
}

export async function hashPasswordLegacySha256(password: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
    return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return bytesToHex(new Uint8Array(mac));
}

export function isUpgradedPasswordHash(stored: string): boolean {
    return stored.startsWith(V2_PREFIX);
}

export async function hashPasswordV2(secret: string, password: string, saltHex?: string): Promise<string> {
    const salt = saltHex ?? bytesToHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
    const mac = await hmacSha256Hex(secret, `${salt}:${password}`);
    return `${V2_PREFIX}${salt}:${mac}`;
}

export async function verifyPassword(secret: string, password: string, stored: string | null | undefined): Promise<boolean> {
    if (!stored) {
        return false;
    }
    if (stored.startsWith(V2_PREFIX)) {
        const rest = stored.slice(V2_PREFIX.length);
        const separator = rest.indexOf(":");
        if (separator <= 0) {
            return false;
        }
        const salt = rest.slice(0, separator);
        const mac = rest.slice(separator + 1);
        if (!salt || !mac) {
            return false;
        }
        const expected = await hmacSha256Hex(secret, `${salt}:${password}`);
        return timingSafeEqualHex(mac, expected);
    }
    if (LEGACY_SHA256_HEX.test(stored)) {
        const hashed = await hashPasswordLegacySha256(password);
        return timingSafeEqualHex(hashed, stored);
    }
    return false;
}

export function needsPasswordRehash(stored: string | null | undefined): boolean {
    return !stored || !isUpgradedPasswordHash(stored);
}
