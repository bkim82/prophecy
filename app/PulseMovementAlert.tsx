"use client";

import { useEffect, useRef, useState } from "react";

const MOVEMENT_THRESHOLD = 0.05;
const ALERT_DURATION_MS = 1800;

type AlertState = {
  id: number;
  percentage: number;
};

export default function PulseMovementAlert({ total }: { total: number }) {
  const baselineRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const [alert, setAlert] = useState<AlertState | null>(null);

  useEffect(() => {
    if (!Number.isFinite(total) || total < 0) return;

    if (baselineRef.current === null) {
      baselineRef.current = total;
      return;
    }

    const baseline = baselineRef.current;
    if (baseline <= 0) {
      baselineRef.current = total;
      return;
    }

    const percentage = ((total - baseline) / baseline) * 100;
    if (Math.abs(percentage) < MOVEMENT_THRESHOLD * 100) return;

    baselineRef.current = total;
    const nextAlert = { id: Date.now(), percentage };
    setAlert(nextAlert);
    document.documentElement.classList.remove("pulse-screen-shake");
    void document.documentElement.offsetWidth;
    document.documentElement.classList.add("pulse-screen-shake");

    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setAlert(null), ALERT_DURATION_MS);
  }, [total]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    document.documentElement.classList.remove("pulse-screen-shake");
  }, []);

  if (!alert) return null;

  const isPositive = alert.percentage >= 0;
  return (
    <div
      key={alert.id}
      role="status"
      aria-live="assertive"
      className={`pulse-movement-alert ${isPositive ? "is-positive" : "is-negative"}`}
    >
      {isPositive ? "+" : ""}{alert.percentage.toFixed(2)}%
    </div>
  );
}
