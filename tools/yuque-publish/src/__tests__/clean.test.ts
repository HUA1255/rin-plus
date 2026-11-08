import { describe, expect, it } from "bun:test";
import { cleanBody, isNeutralColor } from "../clean";

describe("isNeutralColor", () => {
  it("treats Yuque default near-black as neutral", () => {
    expect(isNeutralColor("rgba(0, 0, 0, 0.9)")).toBe(true);
    expect(isNeutralColor("#262626")).toBe(true);
    expect(isNeutralColor("#000")).toBe(true);
  });
  it("keeps real highlight colors", () => {
    expect(isNeutralColor("#DF2A3F")).toBe(false);
    expect(isNeutralColor("rgb(37, 99, 235)")).toBe(false);
  });
});

describe("cleanBody", () => {
  it("unwraps near-black <font> and keeps bold markers intact", () => {
    const src =
      '<font style="color:rgba(0, 0, 0, 0.9);">配套的</font>**<font style="color:rgba(0, 0, 0, 0.9);">系统架构</font>**<font style="color:rgba(0, 0, 0, 0.9);">，它</font>';
    expect(cleanBody(src)).toBe("配套的**系统架构**，它\n");
  });

  it("turns colored <font> into <span>", () => {
    expect(cleanBody('说法：<font style="color:#DF2A3F;">负载越高</font>')).toBe('说法：<span style="color:#DF2A3F">负载越高</span>\n');
  });

  it("unwraps nested <font>", () => {
    expect(cleanBody('<font style="color:#000"><font style="color:#DF2A3F;">红</font></font>')).toBe(
      '<span style="color:#DF2A3F">红</span>\n',
    );
  });

  it("escapes non-HTML angle brackets in prose but not in code", () => {
    const src = "在 Issue 下 @<Agent账号> 评论，或写 `@<Agent账号> <请求>`\n\n```\n<Agent账号>\n```";
    expect(cleanBody(src)).toBe("在 Issue 下 @&lt;Agent账号&gt; 评论，或写 `@<Agent账号> <请求>`\n\n```\n<Agent账号>\n```\n");
  });

  it("keeps real HTML and removes Yuque anchors", () => {
    expect(cleanBody('<a name="x1"></a>第一行<br/>第二行')).toBe("第一行<br/>第二行\n");
  });
});
