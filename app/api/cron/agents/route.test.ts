import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runAgents = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents", () => ({ runAgents }));

import { GET } from "@/app/api/cron/agents/route";

const call = (query = "", authorization?: string) =>
  GET(new Request(`http://localhost/api/cron/agents${query}`, { headers: authorization ? { authorization } : {} }));

describe("GET /api/cron/agents", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    runAgents.mockResolvedValue([{ handle: "miatrades", post: { status: "skipped" }, reply: { status: "skipped" } }]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("401s without the cron secret, a wrong one, or when none is configured", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("", "Bearer nope")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("", "Bearer ")).status).toBe(401);
    expect(runAgents).not.toHaveBeenCalled();
  });

  it("runs the agents with the secret, passing force and dry-run through", async () => {
    const res = await call("?force=1&dry=1", "Bearer s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ handle: "miatrades", post: { status: "skipped" }, reply: { status: "skipped" } }] });
    expect(runAgents).toHaveBeenCalledWith({ force: true, dryRun: true });
    await call("", "Bearer s3cret");
    expect(runAgents).toHaveBeenLastCalledWith({ force: false, dryRun: false });
  });
});
