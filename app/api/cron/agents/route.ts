import { timingSafeEqual } from "node:crypto";
import { runAgents } from "@/lib/agents";

export const dynamic = "force-dynamic";
// Up to MAX_DRAFTS_PER_RUN model calls, one at a time (lib/agents.ts);
// generous so a slow provider doesn't cut a run short.
export const maxDuration = 300;

const authorized = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

/**
 * The AI accounts' tick (lib/agents.ts runAgents: posts and replies),
 * called by Vercel Cron (vercel.ts) with `Authorization: Bearer
 * $CRON_SECRET`. 401 without it, or when CRON_SECRET isn't set. Does
 * nothing unless AGENTS_ENABLED=true → { results: [], disabled: true }.
 * `?force=1` makes every persona due now, ignoring its schedule (still capped
 * per run); `?dry=1` drafts without saving. → { results: [{ handle, post, reply }] }.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.AGENTS_ENABLED !== "true") {
    return Response.json({ results: [], disabled: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const params = new URL(request.url).searchParams;
  const results = await runAgents({ force: params.get("force") === "1", dryRun: params.get("dry") === "1" });
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
