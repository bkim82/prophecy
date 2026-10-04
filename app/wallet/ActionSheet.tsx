"use client";

import { useEffect } from "react";

/** Shared modal shell for Deposit/Send/Swap — none of them move real funds this pass (see docs/wallet.md). */
export function ActionSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="wd-sheet-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="wd-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="wd-sheet-heading">
          <h2>{title}</h2>
          <button type="button" className="wd-sheet-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
