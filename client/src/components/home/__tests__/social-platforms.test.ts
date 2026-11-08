import { describe, expect, it } from "bun:test";
import { normalizeEmail, normalizeSocialUrl, resolveSocialLinks } from "../social-platforms";
import { moveItem } from "../../../page/settings-pinned";

describe("resolveSocialLinks", () => {
    it("shows only filled platforms, in display order, with RSS last", () => {
        const config: Record<string, string> = {
            "social.github": "github.com/octocat",
            "social.xiaohongshu": "https://www.xiaohongshu.com/user/profile/abc",
            "social.email": "mailto:me@example.com",
            "social.bilibili": "  ",
        };
        const links = resolveSocialLinks((key) => config[key], true);
        expect(links.map((link) => link.id)).toEqual(["xiaohongshu", "github", "email", "rss"]);
        expect(links.find((link) => link.id === "github")?.value).toBe("https://github.com/octocat");
        expect(links.find((link) => link.id === "email")?.value).toBe("me@example.com");
        expect(links.at(-1)?.value).toBe("/rss.xml");
    });

    it("hides RSS when it is turned off", () => {
        expect(resolveSocialLinks(() => "", false)).toEqual([]);
    });

    it("marks WeChat as a QR code", () => {
        const [link] = resolveSocialLinks((key) => (key === "social.wechat_qr" ? "https://img.example.com/qr.png" : ""), false);
        expect(link.kind).toBe("qr");
    });
});

describe("normalizers", () => {
    it("keeps http links and relative paths", () => {
        expect(normalizeSocialUrl("http://a.com")).toBe("http://a.com");
        expect(normalizeSocialUrl("/rss.xml")).toBe("/rss.xml");
        expect(normalizeSocialUrl("")).toBe("");
        expect(normalizeEmail(" a@b.c ")).toBe("a@b.c");
        expect(normalizeSocialUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    });

    it("drops unsafe schemes", () => {
        expect(normalizeSocialUrl("javascript:alert(1)")).toBe("");
        expect(resolveSocialLinks((key) => (key === "social.github" ? "javascript:alert(1)" : ""), false)).toEqual([]);
    });
});

describe("moveItem", () => {
    it("moves an item and ignores moves past either end", () => {
        expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
        expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
        expect(moveItem([1, 2, 3], 2, 3)).toEqual([1, 2, 3]);
    });
});
