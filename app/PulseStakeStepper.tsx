"use client";

import { useState } from "react";
import { clampPulseStake, pulseMaxStake, PULSE_STAKE_STEP } from "@/lib/pulse";

/**
 * Pulse stake entry: a typed dollar amount nudged by ±$25, plus All in. The
 * value is always clamped into [0, available cash], so whatever it shows is
 * what the server will accept.
 */
export default function PulseStakeStepper({
  stake,
  availableCash,
  disabled,
  onChange,
}: {
  stake: number;
  availableCash: number;
  disabled: boolean;
  onChange: (stake: number) => void;
}) {
  // Raw text while typing, so "12." isn't reformatted to "12.00" mid-keystroke.
  const [draft, setDraft] = useState<string | null>(null);
  const max = pulseMaxStake(availableCash);
  const set = (next: number) => {
    setDraft(null);
    onChange(clampPulseStake(next, availableCash));
  };

  return (
    <div className="pulse-stake">
      <button type="button" disabled={disabled || stake <= 0} onClick={() => set(stake - PULSE_STAKE_STEP)} aria-label={`Decrease stake by $${PULSE_STAKE_STEP}`}>
        −{PULSE_STAKE_STEP}
      </button>
      <label className="pulse-stake-field">
        <span aria-hidden="true">$</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Stake"
          disabled={disabled}
          value={draft ?? stake.toFixed(2)}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const text = event.target.value.replace(/[^\d.]/g, "");
            const typed = Number(text) || 0;
            const next = clampPulseStake(typed, availableCash);
            setDraft(next < typed ? next.toFixed(2) : text);
            onChange(next);
          }}
          onBlur={() => setDraft(null)}
        />
      </label>
      <button type="button" disabled={disabled || stake >= max} onClick={() => set(stake + PULSE_STAKE_STEP)} aria-label={`Increase stake by $${PULSE_STAKE_STEP}`}>
        +{PULSE_STAKE_STEP}
      </button>
      <button type="button" disabled={disabled || max <= 0} onClick={() => set(max)} className={stake > 0 && stake === max ? "is-active" : undefined}>
        All in
      </button>
    </div>
  );
}
