"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SearchIcon } from "@/app/icons";
import { SearchPeople, useSearchResults } from "@/app/SidebarSearch";

// Beta mode's friend finder: the rail search's pill and People rows
// (app/SidebarSearch.tsx), people only — beta mode hides posts. Centered in the
// desktop header (app/layout.tsx); phones, whose header has no room, get it as
// the first row of the Arena toolbar (app/duel/page.tsx). Results float under
// the field; a press outside, tabbing away or Esc (which also clears) closes
// them. Styles: .friend-search in globals.css.

export function FriendSearch({ className }: { className: string }) {
  const [query, setQuery] = useState("");
  // "Find your friends" until the field is focused, then the handle hint.
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const resultsId = useId();
  const trimmed = query.trim();
  const results = useSearchResults(trimmed, { people: true });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <section
      ref={rootRef}
      className={`friend-search ${className}`}
      role="search"
      // Only when focus lands somewhere else: Safari doesn't focus a clicked
      // link, so a press on a result blurs to nothing and must still land.
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label className="sidebar-search-field">
        <SearchIcon />
        <span className="sr-only">Find people by handle</span>
        <input
          type="search"
          value={query}
          placeholder={focused ? "Search by @handle" : "Find your friends"}
          autoComplete="off"
          aria-controls={resultsId}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
        />
      </label>
      {open && results && (
        <div id={resultsId} className="sidebar-search-results" aria-live="polite">
          {results.users.length > 0 ? (
            <SearchPeople users={results.users} />
          ) : (
            <p className="sidebar-search-empty muted">No one matches &ldquo;{trimmed}&rdquo;.</p>
          )}
        </div>
      )}
    </section>
  );
}
