import { describe, expect, it, vi } from "vitest";
import {
  ApplicationSessionError,
  applicationSessionMatches,
  createApplicationSession,
  deleteAllApplicationSessions,
  deleteApplicationSession,
  type ApplicationSession,
} from "./authSession";

const session: ApplicationSession = {
  user: {
    userId: "cdp-user",
    smartAccountAddress: "0x1234567890abcdef1234567890abcdef12345678",
    chainId: 8453,
  },
};

describe("createApplicationSession", () => {
  it("sends the CDP token only in authorization and returns the canonical account", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(session), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createApplicationSession("access-token", fetcher)).resolves.toEqual(session);
    expect(fetcher).toHaveBeenCalledWith("/api/session", {
      method: "POST",
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  });

  it("surfaces the safe server error without accepting a failed response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "A single supported smart account is required" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createApplicationSession("access-token", fetcher)).rejects.toEqual(
      new ApplicationSessionError("A single supported smart account is required", 409),
    );
  });

  it("rejects a malformed successful response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user: { userId: "cdp-user" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(createApplicationSession("access-token", fetcher)).rejects.toEqual(
      new ApplicationSessionError("Invalid application session response", 502),
    );
  });
});

describe("deleteApplicationSession", () => {
  it("uses an empty same-origin JSON mutation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await deleteApplicationSession(fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });
});

describe("deleteAllApplicationSessions", () => {
  it("uses an empty same-origin JSON mutation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await deleteAllApplicationSessions(fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/session/all", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });

  it("surfaces a safe failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: "Not signed in" }, { status: 401 }),
    );
    await expect(deleteAllApplicationSessions(fetcher)).rejects.toEqual(
      new ApplicationSessionError("Not signed in", 401),
    );
  });
});

describe("applicationSessionMatches", () => {
  it("requires the provider user and exactly one matching smart account", () => {
    expect(applicationSessionMatches(session, "cdp-user", ["0x1234567890ABCDEF1234567890ABCDEF12345678"])).toBe(true);
    expect(applicationSessionMatches(session, "other-user", [session.user.smartAccountAddress])).toBe(false);
    expect(applicationSessionMatches(session, "cdp-user", [])).toBe(false);
    expect(applicationSessionMatches(session, "cdp-user", [session.user.smartAccountAddress, "0xother"])).toBe(false);
    expect(applicationSessionMatches({ user: { ...session.user, chainId: 84532 } }, "cdp-user", [session.user.smartAccountAddress])).toBe(false);
  });
});
