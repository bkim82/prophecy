import { describe, expect, it } from "vitest";
import { lineKnots } from "./ArenaChart";

const pts = (...pairs: [number, number][]) => pairs.map(([t, p]) => ({ t, p }));

describe("lineKnots", () => {
  it("drops carried-forward samples so the line interpolates instead of stepping", () => {
    expect(lineKnots(pts([0, 10], [1000, 10], [2000, 10], [3000, 12], [4000, 12], [5000, 12]))).toEqual(
      pts([0, 10], [3000, 12], [5000, 12]),
    );
  });

  it("merges a candle close and the next open that land on the same moment", () => {
    expect(lineKnots(pts([0, 10], [59_999, 11], [60_000, 11.5], [119_999, 12], [120_000, 12.2], [150_000, 12.4]))).toEqual(
      pts([0, 10], [60_000, 11.5], [120_000, 12.2], [150_000, 12.4]),
    );
  });

  it("always keeps the window's first and last points", () => {
    expect(lineKnots(pts([0, 5], [100, 5]))).toEqual(pts([0, 5], [100, 5]));
    expect(lineKnots(pts([0, 5], [10, 6], [1000, 7], [1100, 8]))).toEqual(pts([0, 5], [10, 6], [1100, 8]));
  });
});
