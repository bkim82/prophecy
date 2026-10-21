"use client";

import { useState } from "react";
import { useAppAuth } from "@/app/auth/AuthProvider";
import type { Poll } from "@/app/lib/mockPosts";

// A composer poll under a post. On a saved post (`postId` + `poll.counts`)
// the totals are everyone's votes and yours goes to
// POST /api/posts/[id]/vote — optimistic, rolled back if the request fails;
// signed out, a tap opens sign-in. Otherwise the vote is local, like
// ClashCard's. Tap your choice again to take the vote back. Results show once
// you've voted or the poll has closed; a closed poll takes no votes.
export function PostPoll({ poll, postId }: { poll: Poll; postId?: string }) {
  const { isSignedIn, openSignIn } = useAppAuth();
  const saved = postId !== undefined && poll.counts !== undefined;
  const [vote, setVote] = useState<number | null>(poll.yourVote ?? null);
  const [pending, setPending] = useState(false);
  // Everyone else's votes, then yours (as it stands now) on top.
  const others = (poll.counts ?? poll.choices.map(() => 0)).map((n, i) => n - (poll.yourVote === i ? 1 : 0));
  const counts = others.map((n, i) => n + (vote === i ? 1 : 0));
  const total = counts.reduce((sum, n) => sum + n, 0);
  const showResults = vote !== null || poll.closed === true;

  async function choose(choice: number) {
    if (poll.closed || pending) return;
    const next = vote === choice ? null : choice;
    if (!saved) {
      setVote(next);
      return;
    }
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    const previous = vote;
    setVote(next);
    setPending(true);
    const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice: next }),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) setVote(previous);
  }

  return (
    <div className="post-poll" data-voted={showResults || undefined}>
      {poll.choices.map((choice, i) => {
        const share = total === 0 ? 0 : Math.round((counts[i] / total) * 100);
        return (
          <button
            key={i}
            type="button"
            className="post-poll-choice"
            aria-pressed={vote === i}
            disabled={poll.closed}
            onClick={() => void choose(i)}
          >
            {showResults && <span className="post-poll-fill" style={{ width: `${share}%` }} aria-hidden="true" />}
            <span className="post-poll-label">
              {vote === i && "✓ "}
              {choice}
            </span>
            {showResults && <span className="post-poll-share">{share}%</span>}
          </button>
        );
      })}
      <p className="post-poll-meta">
        {total} {total === 1 ? "vote" : "votes"} · {poll.closed ? "Final results" : `${poll.endsIn} left`}
      </p>
    </div>
  );
}
