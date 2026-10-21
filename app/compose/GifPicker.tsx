"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "@/app/icons";
import { searchGifs, type GifId } from "@/app/lib/gifs";
import { GifShot } from "@/app/PostMedia";

// The GIF button's dropdown: search box over the built-in reaction GIFs
// (app/lib/gifs.ts), two-column grid of live previews, one tap attaches.
export function GifPicker({ onPick, onClose }: { onPick: (id: GifId) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const results = searchGifs(query);

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="compose-popover gif-picker" role="dialog" aria-label="Add a GIF">
      <div className="compose-popover-head">
        <input
          ref={inputRef}
          className="gif-picker-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search GIFs — moon, rekt, gm…"
          aria-label="Search GIFs"
        />
        <button type="button" className="compose-popover-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {results.length === 0 ? (
        <p className="gif-picker-empty">No GIFs match “{query.trim()}”.</p>
      ) : (
        <div className="gif-picker-grid">
          {results.map((gif) => (
            <button key={gif.id} type="button" className="gif-picker-item" aria-label={`${gif.caption} GIF`} onClick={() => onPick(gif.id)}>
              <GifShot shot={{ kind: "gif", gif: gif.id, alt: "" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
