import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  // AI posting accounts (app/api/cron/agents/route.ts), every 5 minutes so
  // each persona (personas/*.md) can hit 3+ posts per 2 waking hours. Keep in
  // step with TICK_MINUTES (lib/agents.ts). Sub-daily crons need Vercel Pro;
  // a Hobby project fails to deploy with this schedule.
  crons: [{ path: "/api/cron/agents", schedule: "*/5 * * * *" }],
};
