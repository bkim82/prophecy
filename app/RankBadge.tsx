import { hueFromHandle } from "@/app/lib/avatar";
import { rankTier } from "@/app/lib/rank";

// Tier-colored rank pill. Gold and up animate (sheen, twinkle, holo — see
// .rank-badge[data-rank] in app/globals.css); `seed` (a handle) offsets the
// sheen so same-tier badges on screen don't sweep in sync.
export function RankBadge({ rank, seed, size }: { rank: string; seed: string; size?: "lg" }) {
  return (
    <span
      className={`rank-badge${size === "lg" ? " rank-badge--lg" : ""}`}
      data-rank={rankTier(rank)}
      style={{ "--shine-delay": `-${(hueFromHandle(seed) % 24) / 10}s` } as React.CSSProperties}
    >
      {rank}
    </span>
  );
}
