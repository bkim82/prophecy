// Shared by the live socket hook and the history seed so the two can't drift
// out of step: same window, same one-point-per-interval resolution.
export const WINDOW_MS = 3 * 60 * 1000;
export const SAMPLE_MS = 5000;
