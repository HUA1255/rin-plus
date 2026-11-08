import { commentUpdateSchema } from "@rin/api";
import type { UpdateCommentRequest } from "@rin/api";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { withJsonBody } from "../core/route-boundaries";
import { profileAsync } from "../core/server-timing";
import { comments, feeds, users } from "../db/schema";
import { notify } from "../utils/webhook";
import { resolveWebhookConfig } from "./config-helpers";
import { consumeRateLimit, getClientRateLimitKey } from "../utils/rate-limit";

const COMMENT_RATE_LIMIT = 8;
const COMMENT_RATE_WINDOW_MS = 10 * 60 * 1000;

function sanitizeGuestWebsite(raw: string | undefined | null): string | null {
    const value = raw?.trim() || "";
    if (!value) {
        return "";
    }
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

export function CommentService(): Hono {
    const app = new Hono();

    app.get('/:feed', async (c: AppContext) => {
        const db = c.get('db');
        const admin = c.get('admin');
        const feedId = parseInt(c.req.param('feed'));
        const where = admin
            ? eq(comments.feedId, feedId)
            : and(eq(comments.feedId, feedId), eq(comments.approved, 1));
        
        const comment_list = await profileAsync(c, 'comment_list_db', () => db.query.comments.findMany({
            where,
            columns: {
                feedId: false,
                userId: false,
                ...(admin ? {} : { guestEmail: false }),
            },
            with: {
                user: {
                    columns: { id: true, username: true, avatar: true, permission: true }
                }
            },
            orderBy: [desc(comments.createdAt)]
        }));
        
        const result = comment_list.map((row: any) => {
            if (row.user) {
                return row;
            }
            const { user, ...rest } = row;
            return {
                ...rest,
                user: null,
                guestName: rest.guestName || "",
                guestWebsite: rest.guestWebsite || "",
                ...(admin ? { guestEmail: rest.guestEmail || "" } : {}),
            };
        });
        
        return c.json(result);
    });

    app.post('/:feed', async (c: AppContext) => {
        const db = c.get('db');
        const env = c.get('env');
        const serverConfig = c.get('serverConfig');
        const uid = c.get('uid');
        const admin = c.get('admin');
        const feedId = parseInt(c.req.param('feed'));

        const rateLimit = consumeRateLimit({
            name: "comment-create",
            key: getClientRateLimitKey(c.req.raw.headers),
            limit: COMMENT_RATE_LIMIT,
            windowMs: COMMENT_RATE_WINDOW_MS,
        });
        if (!rateLimit.allowed) {
            c.header("Retry-After", String(rateLimit.retryAfterSec));
            return c.text("Too many requests", 429);
        }

        const body = await profileAsync(c, 'comment_create_parse', () => c.req.json());
        const { content, guestName, guestEmail, guestWebsite } = body;
        
        if (!content) {
            return c.text('Content is required', 400);
        }
        
        const exist = await profileAsync(c, 'comment_create_feed', () => db.query.feeds.findFirst({ where: eq(feeds.id, feedId) }));
        if (!exist) {
            return c.text('Feed not found', 400);
        }

        const approved = admin ? 1 : 0;

        if (uid) {
            const user = await profileAsync(c, 'comment_create_user', () => db.query.users.findFirst({ where: eq(users.id, uid) }));
            if (!user) {
                return c.text('User not found', 400);
            }

            await db.insert(comments).values({
                feedId,
                userId: uid,
                content,
                approved,
            });

            const { webhookUrl, webhookMethod, webhookContentType, webhookHeaders, webhookBodyTemplate } =
                await profileAsync(c, 'comment_create_webhook_config', () => resolveWebhookConfig(serverConfig, env));
            const frontendUrl = new URL(c.req.url).origin;
            try {
                await profileAsync(c, 'comment_create_notify', () => notify(
                    webhookUrl || "",
                    {
                        event: "comment.created",
                        message: `${frontendUrl}/feed/${feedId}\n${user.username} 评论了: ${exist.title}\n${content}`,
                        title: exist.title || "",
                        url: `${frontendUrl}/feed/${feedId}`,
                        username: user.username,
                        content,
                    },
                    {
                        method: webhookMethod,
                        contentType: webhookContentType,
                        headers: webhookHeaders,
                        bodyTemplate: webhookBodyTemplate,
                    },
                ));
            } catch (error) {
                console.error("Failed to send comment webhook", error);
            }
            return c.text('OK');
        }

        if (!guestName || !guestName.trim()) {
            return c.text('Guest name is required', 400);
        }

        const website = sanitizeGuestWebsite(guestWebsite);
        if (website === null) {
            return c.text('Guest website must be an http(s) URL', 400);
        }

        await db.insert(comments).values({
            feedId,
            userId: null,
            content,
            guestName: guestName.trim(),
            guestEmail: guestEmail?.trim() || "",
            guestWebsite: website,
            approved,
        });

        const { webhookUrl, webhookMethod, webhookContentType, webhookHeaders, webhookBodyTemplate } =
            await profileAsync(c, 'comment_create_webhook_config', () => resolveWebhookConfig(serverConfig, env));
        const frontendUrl = new URL(c.req.url).origin;
        try {
            await profileAsync(c, 'comment_create_notify', () => notify(
                webhookUrl || "",
                {
                    event: "comment.created",
                    message: `${frontendUrl}/feed/${feedId}\n游客 ${guestName} 评论了: ${exist.title}\n${content}`,
                    title: exist.title || "",
                    url: `${frontendUrl}/feed/${feedId}`,
                    username: guestName,
                    content,
                },
                {
                    method: webhookMethod,
                    contentType: webhookContentType,
                    headers: webhookHeaders,
                    bodyTemplate: webhookBodyTemplate,
                },
            ));
        } catch (error) {
            console.error("Failed to send comment webhook", error);
        }
        return c.text('OK');
    });

    app.delete('/:id', async (c: AppContext) => {
        const db = c.get('db');
        const uid = c.get('uid');
        const admin = c.get('admin');
        
        if (uid === undefined) {
            return c.text('Unauthorized', 401);
        }
        
        const id_num = parseInt(c.req.param('id'));
        const comment = await profileAsync(c, 'comment_delete_lookup', () => db.query.comments.findFirst({ where: eq(comments.id, id_num) }));
        
        if (!comment) {
            return c.text('Not found', 404);
        }
        
        if (admin) {
            await db.delete(comments).where(eq(comments.id, id_num));
            return c.text('OK');
        }
        
        if (comment.userId !== uid) {
            return c.text('Permission denied', 403);
        }
        
        await db.delete(comments).where(eq(comments.id, id_num));
        return c.text('OK');
    });

    app.patch('/:id', async (c: AppContext) => {
        const uid = c.get('uid');
        const admin = c.get('admin');

        if (uid === undefined) {
            return c.text('Unauthorized', 401);
        }

        if (!admin) {
            return c.text('Permission denied', 403);
        }

        return withJsonBody<UpdateCommentRequest>(commentUpdateSchema, async (c, body) => {
            const db = c.get('db');
            const id_num = parseInt(c.req.param('id'));
            const comment = await profileAsync(c, 'comment_update_lookup', () => db.query.comments.findFirst({ where: eq(comments.id, id_num) }));

            if (!comment) {
                return c.text('Not found', 404);
            }

            await db.update(comments).set({
                approved: body.approved ? 1 : 0,
            }).where(eq(comments.id, id_num));

            return c.text('OK');
        })(c);
    });

    return app;
}
