// Shared by the live socket hook, the history seed and the chart so the three
// can't drift out of step: same window, same one-point-per-interval resolution.
export const WINDOW_MS = 60 * 1000;
export const SAMPLE_MS = 1000;

// Tightest the chart will zoom to. At WINDOW_MS the line is ~60 samples wide;
// at MIN_WINDOW_MS it is ~30, which still draws as a curve rather than a
// polygon — that lower bound is what SAMPLE_MS has to keep up with.
export const MIN_WINDOW_MS = 30 * 1000;

// Axis divisions. The chart takes these as props, so a future settings UI can
// override them per render without touching the defaults here. The counts hold
// across the zoom range; only the step between ticks changes.
export const X_INTERVALS = 6; // labelled time ticks across the window
export const Y_INTERVALS = 4; // gaps between price gridlines
export const X_MINOR_PER_INTERVAL = 2; // unlabelled subdivisions per gap
