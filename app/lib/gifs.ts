// Built-in reaction GIFs for the composer's GIF picker (app/compose/GifPicker.tsx).
// There's no GIF provider key, so these are drawn and looped in HTML/CSS by
// app/PostMedia.tsx GifShot, like the feed's other mock media. `motion` picks
// the loop (.shot--gif[data-motion] in app/globals.css), `seed` the gradient,
// `particle` the emoji that rains/twinkles around it. `tags` feed the search.
export type GifMotion = "rocket" | "shake" | "pulse" | "wobble" | "pump" | "dump" | "sparkle" | "flicker" | "rise" | "rain" | "bounce" | "zoom" | "sink";

export type Gif = {
  id: string;
  caption: string;
  emoji: string;
  motion: GifMotion;
  seed: string;
  particle?: string;
  tags: string[];
};

export const GIFS = [
  { id: "moon", caption: "To the moon", emoji: "🚀", motion: "rocket", seed: "gif-moon-7", particle: "✦", tags: ["moon", "pump", "rocket", "bullish", "send it"] },
  { id: "rekt", caption: "Rekt", emoji: "💀", motion: "shake", seed: "gif-rekt", tags: ["rekt", "liquidated", "dead", "loss", "wrecked"] },
  { id: "pump", caption: "Pump it", emoji: "📈", motion: "pump", seed: "gif-pump-2", tags: ["pump", "green", "up", "bullish", "candles"] },
  { id: "dump", caption: "It's dumping", emoji: "📉", motion: "dump", seed: "gif-dump-9", tags: ["dump", "red", "down", "bearish", "crash", "candles"] },
  { id: "lfg", caption: "LFG", emoji: "🔥", motion: "flicker", seed: "gif-lfg-3", tags: ["lfg", "fire", "hype", "lets go"] },
  { id: "hodl", caption: "Diamond hands", emoji: "💎", motion: "sparkle", seed: "gif-hodl-4", particle: "✦", tags: ["hodl", "hold", "diamond hands", "conviction"] },
  { id: "wagmi", caption: "WAGMI", emoji: "🤝", motion: "pulse", seed: "gif-wagmi", tags: ["wagmi", "together", "community", "gm"] },
  { id: "ngmi", caption: "NGMI", emoji: "🤡", motion: "wobble", seed: "gif-ngmi-5", tags: ["ngmi", "clown", "fail", "cope"] },
  { id: "gm", caption: "gm", emoji: "☀️", motion: "rise", seed: "gif-gm-11", tags: ["gm", "morning", "sun", "wagmi"] },
  { id: "brrr", caption: "Money printer go brrr", emoji: "🖨️", motion: "rain", seed: "gif-brrr", particle: "💸", tags: ["money", "printer", "brrr", "fed", "macro"] },
  { id: "fine", caption: "This is fine", emoji: "☕", motion: "rain", seed: "gif-fine-6", particle: "🔥", tags: ["this is fine", "fire", "cope", "dump"] },
  { id: "bull", caption: "Bullish", emoji: "🐂", motion: "bounce", seed: "gif-bull-1", tags: ["bull", "bullish", "long", "up"] },
  { id: "bear", caption: "Bearish", emoji: "🐻", motion: "sink", seed: "gif-bear-8", tags: ["bear", "bearish", "short", "down"] },
  { id: "lambo", caption: "Wen lambo", emoji: "🏎️", motion: "zoom", seed: "gif-lambo-2", tags: ["lambo", "wen", "rich", "moon"] },
  { id: "brain", caption: "Few understand", emoji: "🧠", motion: "sparkle", seed: "gif-brain-3", particle: "✧", tags: ["few", "understand", "galaxy brain", "smart"] },
  { id: "cope", caption: "Cope", emoji: "🫠", motion: "wobble", seed: "gif-cope-12", tags: ["cope", "melt", "sad", "loss"] },
] as const satisfies readonly Gif[];

export type GifId = (typeof GIFS)[number]["id"];

export const gifById = (id: GifId): Gif => GIFS.find((gif) => gif.id === id)!;

export function searchGifs(query: string): (typeof GIFS)[number][] {
  const q = query.trim().toLowerCase();
  if (!q) return [...GIFS];
  return GIFS.filter((gif) => gif.caption.toLowerCase().includes(q) || gif.tags.some((tag: string) => tag.includes(q)));
}
