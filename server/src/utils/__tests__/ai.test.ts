import { afterEach, describe, expect, it, mock } from "bun:test";
import {
    buildExternalAIChatCompletionsUrl,
    createOpenCodeSessionId,
    isOpenCodeGoUrl,
    normalizeExternalAIBaseUrl,
    OPENCODE_GO_USER_AGENT,
    testAIModel,
} from "../ai";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("normalizeExternalAIBaseUrl", () => {
    it("removes trailing slash", () => {
        expect(normalizeExternalAIBaseUrl("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1");
    });

    it("removes chat completions suffix", () => {
        expect(normalizeExternalAIBaseUrl("https://api.openai.com/v1/chat/completions")).toBe("https://api.openai.com/v1");
    });

    it("removes chat completions suffix after trimming", () => {
        expect(normalizeExternalAIBaseUrl(" https://api.openai.com/v1/chat/completions/ ")).toBe("https://api.openai.com/v1");
    });
});

describe("buildExternalAIChatCompletionsUrl", () => {
    it("builds standard chat completions URL from base URL", () => {
        expect(buildExternalAIChatCompletionsUrl("openai", "https://api.openai.com/v1")).toBe(
            "https://api.openai.com/v1/chat/completions",
        );
    });

    it("normalizes full chat completions URL before rebuilding", () => {
        expect(buildExternalAIChatCompletionsUrl("openai", "https://api.openai.com/v1/chat/completions")).toBe(
            "https://api.openai.com/v1/chat/completions",
        );
    });

    it("falls back to provider preset when api URL is empty", () => {
        expect(buildExternalAIChatCompletionsUrl("openai", "")).toBe(
            "https://api.openai.com/v1/chat/completions",
        );
    });

    it("builds OpenCode Go chat completions URL from the production base URL", () => {
        expect(buildExternalAIChatCompletionsUrl("openai", "https://opencode.ai/zen/go/v1")).toBe(
            "https://opencode.ai/zen/go/v1/chat/completions",
        );
    });
});

describe("isOpenCodeGoUrl", () => {
    it("detects OpenCode Go hostname and path", () => {
        expect(isOpenCodeGoUrl("https://opencode.ai/zen/go/v1")).toBe(true);
        expect(isOpenCodeGoUrl("https://opencode.ai/zen/go/v1/chat/completions")).toBe(true);
        expect(isOpenCodeGoUrl("https://opencode.ai/zen/go")).toBe(true);
    });

    it("does not match ordinary OpenAI, DeepSeek, or Zen-without-Go URLs", () => {
        expect(isOpenCodeGoUrl("https://api.openai.com/v1/chat/completions")).toBe(false);
        expect(isOpenCodeGoUrl("https://api.deepseek.com/v1/chat/completions")).toBe(false);
        expect(isOpenCodeGoUrl("https://opencode.ai/zen/v1/chat/completions")).toBe(false);
        expect(isOpenCodeGoUrl("not a url")).toBe(false);
    });
});

describe("createOpenCodeSessionId", () => {
    it("returns a deterministic UUID-like value for identical messages", async () => {
        const messages = [
            { role: "system" as const, content: "prompt" },
            { role: "user" as const, content: "article" },
        ];

        const first = await createOpenCodeSessionId(messages);
        const second = await createOpenCodeSessionId(messages);

        expect(first).toMatch(UUID_V5_PATTERN);
        expect(second).toBe(first);
    });

    it("changes when the message content changes", async () => {
        const first = await createOpenCodeSessionId([{ role: "user", content: "one" }]);
        const second = await createOpenCodeSessionId([{ role: "user", content: "two" }]);

        expect(second).not.toBe(first);
    });
});

describe("testAIModel OpenCode Go headers", () => {
    it("sends x-opencode-session and a non-generic User-Agent for OpenCode Go", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
            requests.push({ url: String(url), init });
            return new Response(JSON.stringify({
                choices: [{ message: { content: "ok" } }],
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }) as typeof fetch;

        const result = await testAIModel({} as Env, {
            provider: "openai",
            model: "deepseek-v4-flash",
            api_key: "secret",
            api_url: "https://opencode.ai/zen/go/v1",
        }, "Hello");

        expect(result.success).toBe(true);
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe("https://opencode.ai/zen/go/v1/chat/completions");

        const headers = requests[0].init?.headers as Record<string, string>;
        expect(headers["x-opencode-session"]).toMatch(UUID_V5_PATTERN);
        expect(headers["User-Agent"]).toBe(OPENCODE_GO_USER_AGENT);
        expect(headers["Authorization"]).toBe("Bearer secret");
    });
});
