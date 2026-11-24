"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { SearchIcon } from "@/app/icons";
import { avatarGradient } from "@/app/lib/avatar";
import { RankBadge } from "@/app/RankBadge";

// Top of the right rail, above the leaderboard: look up people or posts via
// GET /api/search. Results open inline, not as an overlay — the rail scrolls
// itself, so a popover would be clipped. Esc clears. Beta mode's friend finder
// (app/FriendSearch.tsx) reuses the lookup and the People rows.

export type SearchResults = {
  // `imageUrl` only for real accounts with a photo; everyone else gets the gradient initial.
  users: { handle: string; name: string; rank: string; imageUrl?: string }[];
  posts: { id: string; author: string; handle: string; content: string; timestamp: string }[];
};

const DEBOUNCE_MS = 200;

/**
 * Debounced GET /api/search for an already-trimmed `query`. The last answer
 * stays up while a longer query loads; clearing the query drops it, so the next
 * one never flashes stale rows. `people` skips the posts lookup.
 */
export function useSearchResults(query: string, { people = false } = {}) {
  const [results, setResults] = useState<SearchResults | null>(null);
  if (!query && results) setResults(null);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}${people ? "&people=1" : ""}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: SearchResults | null) => {
          if (data) setResults(data);
        })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, people]);

  return query ? results : null;
}

/** People rows: photo or gradient initial, name + rank, handle; each opens their profile. */
export function SearchPeople({ users }: { users: SearchResults["users"] }) {
  return (
    <ul>
      {users.map((user) => (
        <li key={user.handle}>
          <Link href={`/profile/${user.handle.slice(1)}`} className="sidebar-search-item">
            <span className="sidebar-search-avatar" aria-hidden="true" style={{ background: avatarGradient(user.handle) }}>
              {/* Clerk-hosted or our avatar route; a plain img avoids allow-listing its domain for next/image. */}
              {user.imageUrl ? <img src={user.imageUrl} alt="" /> : user.name.charAt(0).toUpperCase()}
            </span>
            <span className="sidebar-search-text">
              <strong>
                <span className="sidebar-search-name">{user.name}</span>
                <RankBadge rank={user.rank} seed={user.handle} />
              </strong>
              <span className="muted">{user.handle}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SidebarSearch() {
  const [query, setQuery] = useState("");
  const resultsId = useId();
  const trimmed = query.trim();
  const results = useSearchResults(trimmed);

  const empty = results && results.users.length === 0 && results.posts.length === 0;

  return (
    <section className="sidebar-search" role="search">
      <label className="sidebar-search-field">
        <SearchIcon />
        <span className="sr-only">Search people and posts</span>
        <input
          type="search"
          value={query}
          placeholder="Search people & posts"
          autoComplete="off"
          aria-controls={resultsId}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
        />
      </label>
      {results && (
        <div id={resultsId} className="sidebar-search-results" aria-live="polite">
          {empty && <p className="sidebar-search-empty muted">No people or posts match &ldquo;{trimmed}&rdquo;.</p>}
          {results.users.length > 0 && (
            <>
              <h3>People</h3>
              <SearchPeople users={results.users} />
            </>
          )}
          {results.posts.length > 0 && (
            <>
              <h3>Posts</h3>
              <ul>
                {results.posts.map((post) => (
                  <li key={post.id}>
                    <Link href={`/post/${encodeURIComponent(post.id)}`} className="sidebar-search-item">
                      <span className="sidebar-search-text">
                        <span className="muted">
                          <strong>{post.author}</strong> {post.handle} · {post.timestamp}
                        </span>
                        <span className="sidebar-search-snippet">{post.content}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
