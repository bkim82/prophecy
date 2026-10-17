import { describe, expect, it } from "vitest";
import {
  RESET_CONFIRMATION,
  RESET_TABLES,
  assertResetAllowed,
  databaseTarget,
  parseResetArgs,
} from "./prelaunch-account-reset.mjs";

describe("pre-launch account reset guards", () => {
  it("keeps the documented dependency order", () => {
    expect(RESET_TABLES).toEqual([
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
    ]);
  });

  it("defaults to dry-run mode", () => {
    expect(parseResetArgs([])).toEqual({ apply: false, confirmation: null });
  });

  it("rejects unknown arguments", () => {
    expect(() => parseResetArgs(["--force"])).toThrow("Unknown argument");
  });

  it("never allows production", () => {
    expect(() => assertResetAllowed({
      environment: "production",
      apply: false,
      confirmation: null,
    })).toThrow("Production is never allowed");
  });

  it("requires the exact destructive confirmation", () => {
    expect(() => assertResetAllowed({
      environment: "preview",
      apply: true,
      confirmation: "yes",
    })).toThrow(`--confirm=${RESET_CONFIRMATION}`);

    expect(() => assertResetAllowed({
      environment: "preview",
      apply: true,
      confirmation: RESET_CONFIRMATION,
    })).not.toThrow();
  });

  it("redacts database credentials from the target summary", () => {
    expect(databaseTarget("postgresql://user:secret@example.neon.tech/prophecy?sslmode=require")).toEqual({
      host: "example.neon.tech",
      database: "prophecy",
    });
  });
});
