"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/**
 * QR code for a plain string (the deposit address — plain, not an EIP-681 URI,
 * since exchange scanners don't all accept those). Drawn as one SVG path so it
 * stays crisp at any size; dark modules on the white card regardless of theme.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 0 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return { size: qr.size, path: d };
  }, [value]);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="wd-qr-code" role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={path} fill="currentColor" />
    </svg>
  );
}
