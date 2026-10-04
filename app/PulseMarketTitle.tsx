// Arena heading with the market called out: coin glyph + ticker in the market's
// own colour (--market-accent, set by the nearest [data-market]), so BTC and
// ETH rooms read differently at a glance.
const GLYPHS: Record<string, string> = { btc: "₿", eth: "Ξ", doge: "Ð" };

export default function PulseMarketTitle({ market, children }: { market: string; children: React.ReactNode }) {
  const glyph = GLYPHS[market];
  return (
    <h1 className="arena-market-title">
      <span className="arena-market-badge">
        {glyph && <span className={`market-symbol ${market}-symbol`} aria-hidden="true">{glyph}</span>}
        {market.toUpperCase()}
      </span>
      <span>{children}</span>
    </h1>
  );
}
