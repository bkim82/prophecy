const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Same style as the feed's mock timestamps ("16m ago"). Shared by the profile
// (match history, sent challenges) and the Arena lobby's Recent results.
export function playedLabel(playedAt: number, now: number): string {
  const minutes = Math.floor((now - playedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : shortDate.format(playedAt);
}
