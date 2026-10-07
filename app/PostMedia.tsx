import { avatarGradient } from "@/app/lib/avatar";
import type { PostImage } from "@/app/lib/mockPosts";

// X-style media under a post: one item full width, 2–4 tiled in a grid. Each
// kind is a fake screenshot drawn in HTML/SVG from mock fields (see PostImage
// in app/lib/mockPosts.ts) and keeps its own fixed palette whatever the app
// theme, the way a pasted image would. Every item is role="img" with `alt`.

type Shot<K extends PostImage["kind"]> = Extract<PostImage, { kind: K }>;

const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const compact = (n: number) => compactCount.format(n);

// Deterministic per-seed noise (mulberry32) so server and client draw the
// same candles and QR codes.
function seeded(seed: string) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 2654435761);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
const priceDecimals = (ref: number) => (ref < 1 ? 4 : ref < 1000 ? 2 : 0);
const formatPrice = (n: number, decimals: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const CANDLE_COUNT = 44;
const PLOT_W = 440;
const PLOT_H = 200;
// Candles circled by `note`: the spike's neighbourhood, else the latest few.
const NOTE_SPAN = 6;

type Candle = { open: number; close: number; high: number; low: number };

// Seeded noise around a line through `path`; the last close lands exactly on
// the last anchor.
function buildCandles(shot: Shot<"candles">): Candle[] {
  const rand = seeded(shot.seed);
  const { path } = shot;
  const lo = Math.min(...path);
  const hi = Math.max(...path);
  const vol = (hi - lo) * 0.045 || lo * 0.002;
  const anchor = (i: number) => {
    const t = (i / (CANDLE_COUNT - 1)) * (path.length - 1);
    const k = Math.min(Math.floor(t), path.length - 2);
    return path[k] + (path[k + 1] - path[k]) * (t - k);
  };
  const candles: Candle[] = [];
  let open = path[0];
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const close = i === CANDLE_COUNT - 1 ? path[path.length - 1] : anchor(i) + (rand() - 0.5) * 2 * vol;
    candles.push({
      open,
      close,
      high: Math.max(open, close) + rand() * vol * 0.8,
      low: Math.min(open, close) - rand() * vol * 0.8,
    });
    open = close;
  }
  if (shot.spike) {
    const candle = candles[spikeIndex(shot.spike.at)];
    if (shot.spike.price < candle.low) candle.low = shot.spike.price;
    else candle.high = Math.max(candle.high, shot.spike.price);
  }
  return candles;
}

const spikeIndex = (at: number) => Math.round(at * (CANDLE_COUNT - 1));

// Round-number gridlines: the first of 1/2/2.5/5/10 × 10ⁿ that gives about
// four steps across the range.
function niceTicks(min: number, max: number): number[] {
  const raw = (max - min) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let i = Math.ceil(min / step); i * step <= max; i++) ticks.push(i * step);
  return ticks;
}

function CandlesShot({ shot }: { shot: Shot<"candles"> }) {
  const candles = buildCandles(shot);
  const first = candles[0];
  const last = candles[candles.length - 1];
  let min = Math.min(...candles.map((c) => c.low), shot.level?.price ?? Infinity);
  let max = Math.max(...candles.map((c) => c.high), shot.level?.price ?? -Infinity);
  const pad = (max - min) * 0.1;
  min -= pad;
  max += pad;
  const y = (price: number) => round(((max - price) / (max - min)) * PLOT_H);
  const top = (price: number) => `${((max - price) / (max - min)) * 100}%`;
  const slot = PLOT_W / CANDLE_COUNT;
  const decimals = priceDecimals(last.close);
  const price = (n: number) => formatPrice(n, decimals);
  const change = ((last.close - first.open) / first.open) * 100;
  const up = change >= 0;

  // Circle around the noted candles, kept inside the plot.
  const noteEnd = shot.spike ? Math.min(CANDLE_COUNT, spikeIndex(shot.spike.at) + NOTE_SPAN / 2) : CANDLE_COUNT;
  const noted = candles.slice(noteEnd - NOTE_SPAN, noteEnd);
  const noteTop = Math.max(3, y(Math.max(...noted.map((c) => c.high))) - 14);
  const noteBottom = Math.min(PLOT_H - 3, y(Math.min(...noted.map((c) => c.low))) + 14);
  const note = {
    cx: round(slot * (noteEnd - NOTE_SPAN / 2)),
    cy: round((noteTop + noteBottom) / 2),
    rx: round((slot * NOTE_SPAN) / 2 + 8),
    ry: round((noteBottom - noteTop) / 2),
  };

  return (
    <div className="shot shot--candles" role="img" aria-label={shot.alt}>
      <div className="shot-candles-head">
        <span className="shot-candles-pair">
          <strong>{shot.pair}</strong> · {shot.interval} · Prophecy
        </span>
        <span className="shot-candles-ohlc">
          O <b>{price(last.open)}</b> H <b>{price(last.high)}</b> L <b>{price(last.low)}</b> C <b>{price(last.close)}</b>{" "}
          <em className={up ? "is-up" : "is-down"}>
            {up ? "+" : "−"}
            {Math.abs(change).toFixed(2)}%
          </em>
        </span>
      </div>
      <div className="shot-candles-body">
        <div className="shot-candles-plot">
          <svg viewBox={`0 0 ${PLOT_W} ${PLOT_H}`} preserveAspectRatio="none">
            {niceTicks(min, max).map((tick) => (
              <line key={tick} className="shot-candles-grid" x1={0} x2={PLOT_W} y1={y(tick)} y2={y(tick)} />
            ))}
            {shot.level && <line className="shot-candles-level" x1={0} x2={PLOT_W} y1={y(shot.level.price)} y2={y(shot.level.price)} />}
            <line className="shot-candles-last" x1={0} x2={PLOT_W} y1={y(last.close)} y2={y(last.close)} />
            {candles.map((c, i) => {
              const x = round(slot * (i + 0.5));
              const bodyTop = y(Math.max(c.open, c.close));
              return (
                <g key={i} className={c.close >= c.open ? "is-up" : "is-down"}>
                  <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} />
                  <rect x={round(x - slot * 0.31)} width={round(slot * 0.62)} y={bodyTop} height={Math.max(1, round(y(Math.min(c.open, c.close)) - bodyTop))} />
                </g>
              );
            })}
            {shot.note && <ellipse className="shot-candles-circle" {...note} />}
          </svg>
          {shot.level && (
            <span className="shot-candles-level-label" style={{ top: top(shot.level.price) }}>
              {shot.level.label}
            </span>
          )}
          {shot.note && (
            <span
              className="shot-candles-note"
              style={{ right: `${((PLOT_W - note.cx + note.rx) / PLOT_W) * 100}%`, top: `${((note.cy - note.ry) / PLOT_H) * 100}%` }}
            >
              {shot.note}
            </span>
          )}
        </div>
        <div className="shot-candles-axis">
          {niceTicks(min, max).map((tick) => (
            <span key={tick} style={{ top: top(tick) }}>
              {price(tick)}
            </span>
          ))}
          {shot.level && (
            <span className="is-level" style={{ top: top(shot.level.price) }}>
              {price(shot.level.price)}
            </span>
          )}
          <span className={`is-last ${last.close >= last.open ? "is-up" : "is-down"}`} style={{ top: top(last.close) }}>
            {price(last.close)}
          </span>
        </div>
      </div>
    </div>
  );
}

function PostShot({ shot }: { shot: Shot<"post"> }) {
  return (
    <div className="shot shot--post" role="img" aria-label={shot.alt}>
      <div className="shot-post-head">
        <span className="shot-post-avatar" style={{ background: avatarGradient(shot.handle, 70) }}>
          {shot.avatarInitial}
        </span>
        <span className="shot-post-who">
          <strong>{shot.author}</strong>
          <span>{shot.handle}</span>
        </span>
        <span className="shot-post-more">···</span>
      </div>
      <p className="shot-post-text">{shot.content}</p>
      <p className="shot-post-date">
        {shot.date} · <strong>{shot.views}</strong> Views
      </p>
      <p className="shot-post-stats">
        <span>
          <strong>{compact(shot.replies)}</strong> Replies
        </span>
        <span>
          <strong>{compact(shot.reposts)}</strong> Reposts
        </span>
        <span>
          <strong>{compact(shot.likes)}</strong> Likes
        </span>
      </p>
    </div>
  );
}

function HeadlineShot({ shot }: { shot: Shot<"headline"> }) {
  return (
    <div className="shot shot--headline" role="img" aria-label={shot.alt}>
      <div className="shot-headline-masthead">
        <span>{shot.outlet}</span>
        <span className="shot-headline-subscribe">Subscribe</span>
      </div>
      <div className="shot-headline-body">
        <p className="shot-headline-section">{shot.section}</p>
        <p className="shot-headline-title">{shot.headline}</p>
        <p className="shot-headline-dek">{shot.dek}</p>
        <p className="shot-headline-byline">
          By <strong>{shot.byline}</strong> · {shot.time}
        </p>
      </div>
    </div>
  );
}

// Decorative QR-ish block: three finder squares plus seeded cells.
function FakeQr({ seed }: { seed: string }) {
  const rand = seeded(seed);
  const size = 15;
  const finder = (x: number, y: number) => x < 5 && y < 5;
  const inFinder = (x: number, y: number) => finder(x, y) || finder(size - 1 - x, y) || finder(x, size - 1 - y);
  const cells: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inFinder(x, y) && rand() > 0.52) cells.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  const finderPath = (x: number, y: number) => `M${x} ${y}h5v5h-5zM${x + 1} ${y + 1}v3h3v-3zM${x + 2} ${y + 2}h1v1h-1z`;
  return (
    <svg className="shot-pnl-qr" viewBox={`-1 -1 ${size + 2} ${size + 2}`} aria-hidden="true">
      <rect x={-1} y={-1} width={size + 2} height={size + 2} rx={1.5} className="shot-pnl-qr-bg" />
      <path fillRule="evenodd" d={[finderPath(0, 0), finderPath(size - 5, 0), finderPath(0, size - 5), ...cells].join("")} />
    </svg>
  );
}

function PnlShot({ shot }: { shot: Shot<"pnl"> }) {
  const up = shot.roi >= 0;
  const roi = `${up ? "+" : "−"}${Math.abs(shot.roi).toLocaleString("en-US", { maximumFractionDigits: Math.abs(shot.roi) >= 100 ? 0 : 1 })}%`;
  return (
    <div className={`shot shot--pnl ${up ? "is-up" : "is-down"}`} role="img" aria-label={shot.alt}>
      <div className="shot-pnl-brand">
        <span>Prophecy</span>
        <span aria-hidden="true">✦</span>
      </div>
      <div className="shot-pnl-pair">
        <strong>{shot.pair}</strong>
        <span className={shot.side === "LONG" ? "is-up" : "is-down"}>
          {shot.side === "LONG" ? "Long" : "Short"} · {shot.leverage ? `${shot.leverage}x` : "Spot"}
        </span>
      </div>
      <p className="shot-pnl-roi">{roi}</p>
      <dl className="shot-pnl-prices">
        <div>
          <dt>Entry</dt>
          <dd>{shot.entry}</dd>
        </div>
        <div>
          <dt>Exit</dt>
          <dd>{shot.exit}</dd>
        </div>
      </dl>
      <div className="shot-pnl-foot">
        <span>{shot.handle}</span>
        <FakeQr seed={`${shot.handle}:${shot.roi}`} />
      </div>
    </div>
  );
}

function ChatShot({ shot }: { shot: Shot<"chat"> }) {
  return (
    <div className="shot shot--chat" role="img" aria-label={shot.alt}>
      <div className="shot-chat-head">
        <span className="shot-chat-avatar" style={{ background: avatarGradient(shot.title, 70) }}>
          {shot.title[0].toUpperCase()}
        </span>
        <span className="shot-chat-who">
          <strong>{shot.title}</strong>
          <span>{shot.subtitle}</span>
        </span>
      </div>
      <div className="shot-chat-thread">
        <span className="shot-chat-time">{shot.time}</span>
        {shot.messages.map((message, i) => (
          <span key={i} className={`shot-chat-bubble${message.me ? " is-me" : ""}`}>
            {message.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function OrderBookShot({ shot }: { shot: Shot<"orderbook"> }) {
  const [base, quote] = shot.pair.split(/[-/]/);
  const maxSize = Math.max(...shot.asks.map(([, size]) => size), ...shot.bids.map(([, size]) => size));
  const size = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Running totals count outward from the spread.
  const askTotals = shot.asks.map((_, i) => shot.asks.slice(i).reduce((sum, [, s]) => sum + s, 0));
  const bidTotals = shot.bids.map((_, i) => shot.bids.slice(0, i + 1).reduce((sum, [, s]) => sum + s, 0));
  const spread = shot.asks[shot.asks.length - 1][0] - shot.bids[0][0];
  const row = (side: "ask" | "bid", [price, amount]: [number, number], total: number) => (
    <span
      key={`${side}${price}`}
      className={`shot-book-row is-${side}${price === shot.wall ? " is-wall" : ""}`}
      style={{ "--depth": `${Math.max(2, (amount / maxSize) * 100)}%` } as React.CSSProperties}
    >
      <span>{price.toLocaleString("en-US")}</span>
      <span>{size(amount)}</span>
      <span>{size(total)}</span>
      {price === shot.wall && shot.note && <span className="shot-book-note">← {shot.note}</span>}
    </span>
  );
  return (
    <div className="shot shot--book" role="img" aria-label={shot.alt}>
      <div className="shot-book-head">
        <strong>Order Book</strong>
        <span>{shot.pair}</span>
        <span className="shot-book-group">{shot.group} ▾</span>
      </div>
      <div className="shot-book-cols">
        <span>Price ({quote})</span>
        <span>Size ({base})</span>
        <span>Total</span>
      </div>
      {shot.asks.map((level, i) => row("ask", level, askTotals[i]))}
      <div className="shot-book-spread">
        <strong>{shot.last}</strong>
        <span>Spread {spread.toLocaleString("en-US")}</span>
      </div>
      {shot.bids.map((level, i) => row("bid", level, bidTotals[i]))}
    </div>
  );
}

function BarsShot({ shot }: { shot: Shot<"bars"> }) {
  const { bars } = shot;
  const signed = bars.some((bar) => bar.value < 0);
  const maxAbs = Math.max(...bars.map((bar) => Math.abs(bar.value)));
  const money = (n: number, sign = signed) => `${sign ? (n >= 0 ? "+" : "−") : ""}$${Math.abs(n).toLocaleString("en-US")}${shot.unit}`;
  const last = bars[bars.length - 1];
  const headline = signed
    ? { value: money(bars.reduce((sum, bar) => sum + bar.value, 0), true), detail: `net over ${bars.length} days` }
    : { value: money(last.value), detail: `+${Math.round(((last.value - bars[0].value) / bars[0].value) * 100)}% since ${bars[0].label}` };
  // Long series label every third bar, counted back from the latest.
  const labelEvery = bars.length > 10 ? 3 : 1;
  return (
    <div className="shot shot--bars" role="img" aria-label={shot.alt}>
      <div className="shot-bars-head">
        <strong>{shot.title}</strong>
        <span>{shot.subtitle}</span>
      </div>
      <p className="shot-bars-total">
        {headline.value} <span>{headline.detail}</span>
      </p>
      <div className={`shot-bars-plot${signed ? " is-signed" : ""}`}>
        {bars.map((bar, i) => (
          <span
            key={bar.label}
            className={`shot-bar${bar.value < 0 ? " is-neg" : ""}${bar === last ? " is-last" : ""}`}
            style={{ "--h": `${(Math.abs(bar.value) / maxAbs) * 100}%` } as React.CSSProperties}
          >
            <span className="shot-bar-area">
              <i />
              {(bar === last || (signed && bars.length <= 10)) && <b>{money(bar.value)}</b>}
            </span>
            <small>{(bars.length - 1 - i) % labelEvery === 0 ? bar.label : ""}</small>
          </span>
        ))}
      </div>
      <p className="shot-bars-source">Source: {shot.source}</p>
    </div>
  );
}

function ExplorerShot({ shot }: { shot: Shot<"explorer"> }) {
  return (
    <div className="shot shot--explorer" role="img" aria-label={shot.alt}>
      <div className="shot-explorer-head">
        <strong>{shot.network} Explorer</strong>
        <span className="shot-explorer-search">Search by address / txn hash</span>
      </div>
      <p className="shot-explorer-title">Transaction Details</p>
      <dl className="shot-explorer-rows">
        <div>
          <dt>Transaction Hash</dt>
          <dd>
            <code>{shot.hash}</code>
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className="shot-explorer-ok">✓ Confirmed</span>
          </dd>
        </div>
        <div>
          <dt>Block</dt>
          <dd>
            {shot.block} · {shot.age}
          </dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>
            <code>{shot.from}</code> <span className="shot-explorer-tag">{shot.fromTag}</span>
          </dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>
            <code>{shot.to}</code>
          </dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>
            <strong>{shot.value}</strong> <span className="shot-explorer-usd">({shot.usd})</span>
          </dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{shot.fee}</dd>
        </div>
      </dl>
    </div>
  );
}

function MemeShot({ shot }: { shot: Shot<"meme"> }) {
  return (
    <div
      className={`shot shot--meme${shot.top || shot.bottom ? " has-caption" : ""}`}
      role="img"
      aria-label={shot.alt}
      style={{ background: avatarGradient(shot.seed, 70) }}
    >
      {shot.top && <span className="shot-meme-caption">{shot.top}</span>}
      <span className="shot-meme-emoji">{shot.emoji}</span>
      {shot.bottom && <span className="shot-meme-caption">{shot.bottom}</span>}
    </div>
  );
}

function Shot({ shot }: { shot: PostImage }) {
  switch (shot.kind) {
    case "candles":
      return <CandlesShot shot={shot} />;
    case "post":
      return <PostShot shot={shot} />;
    case "headline":
      return <HeadlineShot shot={shot} />;
    case "pnl":
      return <PnlShot shot={shot} />;
    case "chat":
      return <ChatShot shot={shot} />;
    case "orderbook":
      return <OrderBookShot shot={shot} />;
    case "bars":
      return <BarsShot shot={shot} />;
    case "explorer":
      return <ExplorerShot shot={shot} />;
    case "meme":
      return <MemeShot shot={shot} />;
  }
}

export function PostMedia({ media }: { media: PostImage[] }) {
  return (
    <div className={`post-media${media.length > 1 ? " post-media--grid" : ""}`} data-count={media.length}>
      {media.map((shot, i) => (
        <Shot key={i} shot={shot} />
      ))}
    </div>
  );
}
