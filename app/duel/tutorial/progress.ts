/**
 * Whether this browser has finished the Pulse tutorial — a per-viewer
 * convenience (the lobby stops nudging first-timers), never game state.
 * Storage can throw or be empty in private windows; both read as "not done".
 */
const DONE_KEY = "pulse-tutorial-done";

export const TUTORIAL_HREF = "/duel/tutorial";

export function hasFinishedTutorial() {
  try {
    return window.localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTutorialDone() {
  try {
    window.localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Best-effort; the lobby just keeps showing the nudge.
  }
}
