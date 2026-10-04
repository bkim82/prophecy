import { avatarGradient } from "@/app/lib/avatar";
import { callRoi, signedPct } from "@/app/lib/calls";
import type { Post } from "@/app/lib/mockPosts";

// Story-style strip of the calls in the current feed: avatar ringed green/red
// by ROI direction, market, ROI. Each chip jumps to its post (#post-<id>).
export function CallStrip({ posts }: { posts: Post[] }) {
  const calls = posts.flatMap((post) => (post.call ? [{ post, call: post.call }] : []));
  if (calls.length === 0) return null;
  return (
    <nav className="call-strip" aria-label="Calls in this feed">
      {calls.map(({ post, call }) => {
        const roi = callRoi(call);
        return (
          <a key={post.id} href={`#post-${post.id}`} className={`call-chip ${roi >= 0 ? "is-up" : "is-down"}`} title={`${post.author}'s ${call.market.toUpperCase()} ${call.side}`}>
            <span className="call-chip-avatar" aria-hidden="true" style={{ background: avatarGradient(post.handle) }}>
              {post.avatarInitial}
            </span>
            <span className="call-chip-market">{call.market.toUpperCase()}</span>
            <span className="call-chip-roi">{signedPct(roi)}</span>
          </a>
        );
      })}
    </nav>
  );
}
