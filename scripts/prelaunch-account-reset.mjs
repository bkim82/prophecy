import { neon } from "@neondatabase/serverless";
import { pathToFileURL } from "node:url";

export const RESET_TABLES = [
  "transaction_intents",
  "onramp_orders",
  "wallet_spend_counters",
  "wallet_audit_events",
  "positions",
  "portfolio_payouts",
  "portfolio_sessions",
  "match_payouts",
  "matches",
  "challenges",
  "profiles",
  "app_sessions",
  "users",
];

export const RESET_CONFIRMATION = "RESET_PRELAUNCH_ACCOUNT_DATA";
export const ALLOWED_RESET_ENVIRONMENTS = new Set([
  "local",
  "development",
  "test",
  "preview",
]);

export function parseResetArgs(args) {
  let apply = false;
  let confirmation = null;
  for (const arg of args) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--confirm=")) {
      confirmation = arg.slice("--confirm=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { apply, confirmation };
}

export function assertResetAllowed({ environment, apply, confirmation }) {
  if (!environment || !ALLOWED_RESET_ENVIRONMENTS.has(environment)) {
    throw new Error(
      "PRELAUNCH_RESET_ENVIRONMENT must be one of: local, development, test, preview. Production is never allowed.",
    );
  }
  if (apply && confirmation !== RESET_CONFIRMATION) {
    throw new Error(
      `Applying the reset requires --confirm=${RESET_CONFIRMATION}.`,
    );
  }
}

export function databaseTarget(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    database: url.pathname.replace(/^\//, "") || "(default)",
    host: url.hostname,
  };
}

const countQueries = (sql) => [
  sql`SELECT 'transaction_intents' AS table_name, count(*)::int AS row_count FROM transaction_intents`,
  sql`SELECT 'onramp_orders' AS table_name, count(*)::int AS row_count FROM onramp_orders`,
  sql`SELECT 'wallet_spend_counters' AS table_name, count(*)::int AS row_count FROM wallet_spend_counters`,
  sql`SELECT 'wallet_audit_events' AS table_name, count(*)::int AS row_count FROM wallet_audit_events`,
  sql`SELECT 'positions' AS table_name, count(*)::int AS row_count FROM positions`,
  sql`SELECT 'portfolio_payouts' AS table_name, count(*)::int AS row_count FROM portfolio_payouts`,
  sql`SELECT 'portfolio_sessions' AS table_name, count(*)::int AS row_count FROM portfolio_sessions`,
  sql`SELECT 'match_payouts' AS table_name, count(*)::int AS row_count FROM match_payouts`,
  sql`SELECT 'matches' AS table_name, count(*)::int AS row_count FROM matches`,
  sql`SELECT 'challenges' AS table_name, count(*)::int AS row_count FROM challenges`,
  sql`SELECT 'profiles' AS table_name, count(*)::int AS row_count FROM profiles`,
  sql`SELECT 'app_sessions' AS table_name, count(*)::int AS row_count FROM app_sessions`,
  sql`SELECT 'users' AS table_name, count(*)::int AS row_count FROM users`,
];

async function verifyTables(sql) {
  const rows = await sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = ANY(${RESET_TABLES})
  `;
  const existing = new Set(rows.map((row) => row.tablename));
  const missing = RESET_TABLES.filter((table) => !existing.has(table));
  if (missing.length > 0) {
    throw new Error(`Reset aborted; missing tables: ${missing.join(", ")}`);
  }
}

async function rowCounts(sql) {
  const results = await sql.transaction(countQueries(sql), { readOnly: true });
  return results.map(([row]) => ({
    table: row.table_name,
    rows: row.row_count,
  }));
}

export async function runReset({
  args = process.argv.slice(2),
  databaseUrl = process.env.DATABASE_URL_UNPOOLED,
  environment = process.env.PRELAUNCH_RESET_ENVIRONMENT,
} = {}) {
  const options = parseResetArgs(args);
  assertResetAllowed({ environment, ...options });
  if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED is required.");

  const target = databaseTarget(databaseUrl);
  const sql = neon(databaseUrl);
  await verifyTables(sql);
  const before = await rowCounts(sql);

  console.log(`Target: ${target.host}/${target.database}`);
  console.log(`Environment: ${environment}`);
  console.table(before);

  if (!options.apply) {
    console.log(
      `Dry run only. Re-run with --apply --confirm=${RESET_CONFIRMATION} to truncate the listed tables.`,
    );
    return { applied: false, before, target };
  }

  await sql`
    TRUNCATE TABLE
      transaction_intents,
      onramp_orders,
      wallet_spend_counters,
      wallet_audit_events,
      positions,
      portfolio_payouts,
      portfolio_sessions,
      match_payouts,
      matches,
      challenges,
      profiles,
      app_sessions,
      users
  `;

  console.log("Pre-launch account data reset complete.");
  return { applied: true, before, target };
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryPath === import.meta.url) {
  runReset().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
