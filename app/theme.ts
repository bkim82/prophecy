export type Theme = "obsidian" | "navy" | "light";

export const DEFAULT_THEME: Theme = "obsidian";

export const THEME_STORAGE_KEY = "theme";

/** Picker order + copy for the header theme menu (app/ThemeToggle.tsx). */
export const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: "obsidian", label: "Obsidian", hint: "Black & violet" },
  { id: "navy", label: "Navy", hint: "Classic navy & teal" },
  { id: "light", label: "Moonstone", hint: "Light · pearl & violet" },
];

/** Stored "dark" predates Obsidian; it was the dark default, so it maps to the new one. */
export function normalizeTheme(value: string | null): Theme {
  return value === "navy" || value === "light" ? value : DEFAULT_THEME;
}

/**
 * Runs synchronously in <head> so the stored (or default) theme is on <html>
 * before the first paint. Kept in sync with normalizeTheme() above.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="navy"&&t!=="light")t="${DEFAULT_THEME}";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
