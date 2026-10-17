import { describe, expect, it } from "vitest";
import {
  bearerToken,
  emptyJsonBodyFailure,
  mutationRequestFailure,
} from "@/lib/requestSecurity";

function request(headers: Record<string, string>, body = "{}") {
  return new Request("https://prophecy.test/api/session", {
    method: "POST",
    headers,
    body,
  });
}

const validHeaders = {
  origin: "https://prophecy.test",
  host: "prophecy.test",
  "content-type": "application/json; charset=utf-8",
  authorization: "Bearer token-value",
};

describe("session mutation request security", () => {
  it("accepts an exact same-origin JSON mutation and bearer token", async () => {
    const candidate = request(validHeaders);
    expect(mutationRequestFailure(candidate)).toBeNull();
    expect(bearerToken(candidate)).toBe("token-value");
    await expect(emptyJsonBodyFailure(candidate)).resolves.toBeNull();
  });

  it("rejects cross-origin requests", () => {
    expect(mutationRequestFailure(request({
      ...validHeaders,
      origin: "https://attacker.test",
    }))).toBe("invalid-origin");
  });

  it("rejects tokens in the JSON body", async () => {
    await expect(emptyJsonBodyFailure(request(
      validHeaders,
      JSON.stringify({ accessToken: "do-not-accept-this" }),
    ))).resolves.toBe("unexpected-body");
  });

  it("requires the exact Bearer authorization shape", () => {
    expect(bearerToken(request({
      ...validHeaders,
      authorization: "bearer token-value",
    }))).toBeNull();
  });
});
