export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

/**
 * Runs synchronously in <head> so the stored (or default) theme is on <html>
 * before the first paint. Kept in sync with readTheme() in ThemeToggle.tsx.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
