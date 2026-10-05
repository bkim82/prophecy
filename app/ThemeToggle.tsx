"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES, normalizeTheme, type Theme } from "./theme";

function readTheme(): Theme {
  try {
    return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  // The inline script already set the attribute; this syncs React's state to it
  // and re-applies it after Strict Mode's dev remount clears <html>'s attributes.
  // The observer keeps the desktop and mobile header copies in step.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const current = readTheme();
    root.setAttribute("data-theme", current);
    setThemeState(current);
    const observer = new MutationObserver(() => setThemeState(normalizeTheme(root.getAttribute("data-theme"))));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  function setTheme(next: Theme) {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
    setThemeState(next);
  }

  return { theme, setTheme };
}

// Header theme picker (top right, signed in or out): swatch button → menu.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = THEMES.find((option) => option.id === theme) ?? THEMES[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="theme-menu">
      <button
        type="button"
        className="theme-toggle"
        title={`Theme: ${current.label}`}
        aria-label={`Theme: ${current.label} — change theme`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="theme-swatch" data-swatch={theme} aria-hidden="true" />
      </button>
      {open && (
        <div className="theme-menu-popover" role="menu" aria-label="Theme">
          {THEMES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === theme}
              onClick={() => {
                setTheme(option.id);
                setOpen(false);
              }}
            >
              <span className="theme-swatch" data-swatch={option.id} aria-hidden="true" />
              <span className="theme-menu-text">
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
              {option.id === theme && <span className="theme-menu-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
