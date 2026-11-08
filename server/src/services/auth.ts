import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext, Variables } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { setJWTCookie } from "../core/hono-middleware";
import { users } from "../db/schema";
import {
    BadRequestError,
    ForbiddenError,
    InternalServerError,
    RateLimitError,
} from "../errors";
import {
    hashPasswordLegacySha256,
    hashPasswordV2,
    needsPasswordRehash,
    timingSafeEqualHex,
    verifyPassword,
} from "../utils/password";
import { consumeRateLimit, getClientRateLimitKey } from "../utils/rate-limit";

const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

export function PasswordAuthService(): Hono<{
        Bindings: Env;
        Variables: Variables;
    }> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();
    // Login with username and password
    app.post("/login", async (c: AppContext) => {
        const jwt = c.get('jwt');
        const db = c.get('db');
        const env = c.env;
        const jwtSecret = env.JWT_SECRET;

        const rateLimit = consumeRateLimit({
            name: "auth-login",
            key: getClientRateLimitKey(c.req.raw.headers),
            limit: LOGIN_RATE_LIMIT,
            windowMs: LOGIN_RATE_WINDOW_MS,
        });
        if (!rateLimit.allowed) {
            c.header("Retry-After", String(rateLimit.retryAfterSec));
            throw new RateLimitError("Too many login attempts");
        }

        // Check if admin credentials are configured
        const adminUsername = env.ADMIN_USERNAME;
        const adminPassword = env.ADMIN_PASSWORD;

        if (!adminUsername || !adminPassword) {
            throw new BadRequestError('Admin credentials not configured');
        }

        if (!jwtSecret) {
            throw new InternalServerError('JWT secret is not configured');
        }

        const { username, password } = await profileAsync(c, 'auth_login_parse', () => c.req.json()) as { username: string; password: string };

        if (!username || !password) {
            throw new BadRequestError('Username and password are required');
        }

        const submittedLegacyHash = await profileAsync(c, 'auth_login_hash', () => hashPasswordLegacySha256(password));
        const expectedAdminHash = await profileAsync(c, 'auth_admin_hash', () => hashPasswordLegacySha256(adminPassword));
        const adminEnvMatch = username === adminUsername && timingSafeEqualHex(submittedLegacyHash, expectedAdminHash);

        if (username === adminUsername) {
            let user = await profileAsync(c, 'auth_admin_lookup', () => db.query.users.findFirst({ 
                where: eq(users.openid, "admin") 
            }));

            const storedPassword = user?.password;
            const storedMatch = storedPassword
                ? await profileAsync(c, 'auth_admin_stored_verify', () => verifyPassword(jwtSecret, password, storedPassword))
                : false;

            if (!adminEnvMatch && !storedMatch) {
                throw new ForbiddenError('Invalid credentials');
            }

            const upgradedHash = await profileAsync(c, 'auth_admin_upgrade', () => hashPasswordV2(jwtSecret, password));

            if (!user) {
                const result = await profileAsync(c, 'auth_admin_insert', () => db.insert(users).values({
                    username: adminUsername,
                    openid: "admin",
                    avatar: "",
                    permission: 1,
                    password: upgradedHash,
                }).returning({ insertedId: users.id }));

                if (!result || result.length === 0) {
                    throw new InternalServerError('Failed to create admin user');
                }

                user = await profileAsync(c, 'auth_admin_reload', () => db.query.users.findFirst({ 
                    where: eq(users.id, result[0].insertedId) 
                }));
            } else if (needsPasswordRehash(user.password) || user.username !== adminUsername) {
                const userId = user.id;
                const upgradedHashSnapshot = upgradedHash;
                await profileAsync(c, 'auth_admin_sync', () => db.update(users)
                    .set({ password: upgradedHashSnapshot, username: adminUsername })
                    .where(eq(users.id, userId)));
                user = { ...user, password: upgradedHashSnapshot, username: adminUsername };
            }

            if (!user) {
                throw new InternalServerError('Failed to get admin user');
            }

            const token = await profileAsync(c, 'auth_admin_token', () => jwt.sign({ id: user.id }));
            setJWTCookie(c, token);

            return c.json({
                success: true,
                token: token,
                user: {
                    id: user.id,
                    username: user.username,
                    avatar: user.avatar,
                    permission: user.permission === 1,
                }
            });
        }

        const user = await profileAsync(c, 'auth_user_lookup', () => db.query.users.findFirst({ 
            where: eq(users.username, username) 
        }));

        if (!user || !user.password) {
            throw new ForbiddenError('Invalid credentials');
        }

        const passwordMatch = await profileAsync(c, 'auth_user_verify', () => verifyPassword(jwtSecret, password, user.password));
        if (!passwordMatch) {
            throw new ForbiddenError('Invalid credentials');
        }

        if (needsPasswordRehash(user.password)) {
            const upgradedHash = await profileAsync(c, 'auth_user_upgrade', () => hashPasswordV2(jwtSecret, password));
            await profileAsync(c, 'auth_user_sync', () => db.update(users)
                .set({ password: upgradedHash })
                .where(eq(users.id, user.id)));
        }

        const token = await profileAsync(c, 'auth_user_token', () => jwt.sign({ id: user.id }));
        setJWTCookie(c, token);

        return c.json({
            success: true,
            token: token,
            user: {
                id: user.id,
                username: user.username,
                avatar: user.avatar,
                permission: user.permission === 1,
            }
        });
    });

    // Check if password login is available
    app.get("/status", async (c: AppContext) => {
        const env = c.env;
        
        return c.json({
            github: !!(env.RIN_GITHUB_CLIENT_ID && env.RIN_GITHUB_CLIENT_SECRET),
            password: !!(env.ADMIN_USERNAME && env.ADMIN_PASSWORD),
        });
    });

    return app;
}
