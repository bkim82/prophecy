// Shared by the live socket hook, the history seed and the chart so the three
// can't drift out of step: same window, same one-point-per-interval resolution.
export const WINDOW_MS = 3 * 60 * 1000;
export const SAMPLE_MS = 5000;

// Axis divisions. The chart takes these as props, so a future settings UI can
// override them per render without touching the defaults here.
export const X_INTERVALS = 6; // labelled time ticks across the window
export const Y_INTERVALS = 4; // gaps between price gridlines
export const X_MINOR_PER_INTERVAL = 2; // unlabelled subdivisions per gap
