"use client";

import { CloseIcon } from "@/app/icons";

// What people actually type on crypto timelines, in rough order of use.
const EMOJI = [
  "🚀", "🔥", "💎", "🙌", "📈", "📉", "🐂", "🐻",
  "💀", "😭", "😂", "🤣", "👀", "🧠", "🤝", "🫡",
  "💸", "💰", "🤑", "🏦", "🎯", "⚡", "✨", "🔮",
  "🌙", "☀️", "🐸", "🐕", "🦍", "🍌", "🤡", "🫠",
  "😤", "🥶", "🙏", "👑", "🎰", "🧨", "🩸", "🪦",
  "✅", "❌", "⚠️", "💯", "📊", "🧵", "👇", "🤔",
];

// The emoji button's dropdown. Stays open so you can add several; each pick
// is inserted at the cursor by the composer.
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <div className="compose-popover emoji-picker" role="dialog" aria-label="Add emoji">
      <div className="compose-popover-head">
        <h2>Emoji</h2>
        <button type="button" className="compose-popover-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="emoji-picker-grid">
        {EMOJI.map((emoji) => (
          <button key={emoji} type="button" className="emoji-picker-item" aria-label={`Insert ${emoji}`} onClick={() => onPick(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
