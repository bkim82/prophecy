import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/alchemy", () => ({ getTokenMetadata: vi.fn() }));
vi.mock("@/lib/cdp", () => ({ getCdpUserOperation: vi.fn() }));

import { callHash } from "@/lib/transactionIntents";

const calls = [
  { to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", value: "0", data: "0x095ea7b3" },
  { to: "0x2222222222222222222222222222222222222222", value: "10", data: "0x" },
];

describe("callHash", () => {
  it("is stable across jsonb key reordering", () => {
    // Postgres jsonb stores keys shortest-first: {to, data, value}.
    const fromJsonb = calls.map(({ to, data, value }) => ({ to, data, value }));
    expect(JSON.stringify(fromJsonb)).not.toBe(JSON.stringify(calls));
    expect(callHash(fromJsonb)).toBe(callHash(calls));
  });

  it("changes when any call field changes", () => {
    expect(callHash([calls[0], { ...calls[1], value: "11" }])).not.toBe(callHash(calls));
  });
});
