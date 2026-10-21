import { describe, expect, it } from "vitest";
import { parsePostInput } from "@/lib/postInput";

// 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("parsePostInput", () => {
  it("accepts a text post with topics, a trade ref and a poll", () => {
    const input = parsePostInput({
      content: "  told you  ",
      topics: ["pepe", "#Pump.fun", "pepe"],
      tradeId: "portfolio:abc-123",
      poll: { choices: [" send it ", "fade it"], duration: "1d" },
    });
    expect(input).toEqual({
      content: "told you",
      topics: ["pepe", "#Pump.fun"],
      tradeRef: "portfolio:abc-123",
      gif: null,
      poll: { choices: ["send it", "fade it"], durationMs: 86_400_000 },
      photos: [],
    });
  });

  it("checks photos from their bytes", () => {
    const input = parsePostInput({ content: "chart", photos: [{ mime: "image/png", data: PNG }] });
    expect(input).toMatchObject({ photos: [{ mime: "image/png", width: 1, height: 1 }] });
    expect(parsePostInput({ content: "x", photos: [{ mime: "image/jpeg", data: PNG }] })).toHaveProperty("error");
    expect(parsePostInput({ content: "x", photos: [{ mime: "image/png", data: "not base64!" }] })).toHaveProperty("error");
  });

  it.each([
    ["too long", { content: "x".repeat(281) }],
    ["too many topics", { content: "x", topics: ["pepe", "bonk", "wif", "ai"] }],
    ["a malformed custom topic", { content: "x", topics: ["#<b>"] }],
    ["a malformed trade ref", { content: "x", tradeId: "positions:1; drop table" }],
    ["an unknown GIF", { content: "x", gif: "nope" }],
    ["a one-choice poll", { content: "x", poll: { choices: ["only"], duration: "1d" } }],
    ["an unknown poll length", { content: "x", poll: { choices: ["a", "b"], duration: "2y" } }],
    ["a GIF and a poll together", { content: "x", gif: "moon", poll: { choices: ["a", "b"], duration: "1h" } }],
    ["nothing to post", { content: "   " }],
    ["a poll alone", { poll: { choices: ["a", "b"], duration: "1h" } }],
  ])("rejects %s", (_label, body) => {
    expect(parsePostInput(body as Record<string, unknown>)).toHaveProperty("error");
  });
});
