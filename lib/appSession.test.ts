import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  appSessionTokenHash,
  rateLimitKey,
  SessionConfigurationError,
} from "@/lib/appSession";

describe("application session hashes", () => {
  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it("produces a deterministic keyed hash instead of storing the opaque token", () => {
    process.env.SESSION_SECRET = "a".repeat(32);

    const hash = appSessionTokenHash("opaque-session-token");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("opaque-session-token");
    expect(appSessionTokenHash("opaque-session-token")).toBe(hash);
  });

  it("domain-separates rate-limit subjects from session tokens", () => {
    process.env.SESSION_SECRET = "b".repeat(32);

    expect(rateLimitKey("session:ip", "same-value"))
      .not.toContain(appSessionTokenHash("same-value"));
  });

  it("rejects a missing or short session secret", () => {
    process.env.SESSION_SECRET = "too-short";

    expect(() => appSessionTokenHash("token")).toThrow(SessionConfigurationError);
  });
});
