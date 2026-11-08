import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FeedService } from '../feed';
import { Hono } from "hono";
import type { Variables } from "../../core/hono-types";
import { setupTestApp, createTestUser, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';

const ADMIN = { 'Authorization': 'Bearer mock_token_1', 'Content-Type': 'application/json' };

describe('FeedService pinned posts', () => {
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;

    beforeEach(async () => {
        const ctx = await setupTestApp(FeedService);
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;
        await createTestUser(sqlite);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function createFeed(title: string, listed = true) {
        const res = await app.request('/', {
            method: 'POST',
            headers: ADMIN,
            body: JSON.stringify({ title, content: `${title} content`, listed, draft: false, tags: [] }),
        }, env);
        expect(res.status).toBe(200);
        return ((await res.json()) as any).insertedId as number;
    }

    async function setTop(id: number, top: number) {
        const res = await app.request(`/top/${id}`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ top }) }, env);
        expect(res.status).toBe(200);
    }

    async function pinnedTitles() {
        const res = await app.request('/pinned', { method: 'GET' }, env);
        expect(res.status).toBe(200);
        return ((await res.json()) as any[]).map((feed) => feed.title);
    }

    it('lists pinned posts newest pin first and keeps them out of the excluded list', async () => {
        const a = await createFeed('A');
        const b = await createFeed('B');
        await createFeed('C');

        await setTop(a, 1);
        await setTop(b, 1);

        expect(await pinnedTitles()).toEqual(['B', 'A']);

        const listRes = await app.request('/?pinned=exclude', { method: 'GET' }, env);
        const list = (await listRes.json()) as any;
        expect(list.data.map((feed: any) => feed.title)).toEqual(['C']);
        expect(list.size).toBe(1);

        const fullRes = await app.request('/', { method: 'GET' }, env);
        expect(((await fullRes.json()) as any).size).toBe(3);
    });

    it('keeps the place of a post that is pinned again and unpins with top 0', async () => {
        const a = await createFeed('A');
        const b = await createFeed('B');
        await setTop(a, 1);
        await setTop(b, 1);
        await setTop(a, 1);
        expect(await pinnedTitles()).toEqual(['B', 'A']);

        await setTop(b, 0);
        expect(await pinnedTitles()).toEqual(['A']);
    });

    it('does not show unlisted pinned posts', async () => {
        const hidden = await createFeed('Hidden', false);
        await setTop(hidden, 1);
        expect(await pinnedTitles()).toEqual([]);
    });

    it('reorders pinned posts and unpins the ones left out', async () => {
        const a = await createFeed('A');
        const b = await createFeed('B');
        const c = await createFeed('C');
        await setTop(a, 1);
        await setTop(b, 1);
        await setTop(c, 1);
        expect(await pinnedTitles()).toEqual(['C', 'B', 'A']);

        const res = await app.request('/pinned/order', { method: 'POST', headers: ADMIN, body: JSON.stringify({ ids: [a, c] }) }, env);
        expect(res.status).toBe(200);
        expect(await pinnedTitles()).toEqual(['A', 'C']);

        await setTop(b, 1);
        expect(await pinnedTitles()).toEqual(['B', 'A', 'C']);
    });

    it('requires admin to reorder', async () => {
        const res = await app.request('/pinned/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [1] }),
        }, env);
        expect(res.status).toBe(403);
    });
});
