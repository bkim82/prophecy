import type { VercelConfig } from "@vercel/config/v1";

// No crons here: Vercel Hobby only allows daily crons, and the AI posting
// accounts need a 5-minute tick. It runs from .github/workflows/agents-cron.yml.
export const config: VercelConfig = {};
