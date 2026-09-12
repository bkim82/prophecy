import Link from "next/link";

type Mode = {
  key: "quick" | "pulse" | "24hr";
  name: string;
  description: string;
  href?: string;
};

type DuelType = {
  key: string;
  name: string;
  description: string;
  modes: Mode[];
};

const MODES: Omit<Mode, "href">[] = [
  {
    key: "quick",
    name: "Quick Play",
    description: "60-second round. Lock a prediction, watch it settle.",
  },
  {
    key: "pulse",
    name: "Pulse Mode",
    description: "Solo. Buy and sell live BTC for 60 seconds — maximize profit.",
  },
  {
    key: "24hr",
    name: "24hr Battle",
    description: "One prediction, settled a full day later.",
  },
];

const DUEL_TYPES: DuelType[] = [
  {
    key: "btc",
    name: "BTC Duel",
    description: "Predict where Bitcoin / USD lands.",
    modes: MODES.map((mode) => {
      if (mode.key === "quick") return { ...mode, href: "/duel/btc/quick-play" };
      if (mode.key === "pulse") return { ...mode, href: "/duel/btc/pulse" };
      return mode;
    }),
  },
  {
    key: "eth",
    name: "ETH Duel",
    description: "Predict where Ethereum / USD lands.",
    modes: MODES.map((mode) => ({ ...mode })),
  },
];

export default function Page() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-center text-sm font-medium uppercase tracking-[0.2em] text-neutral-500">
        Duel Menu
      </h1>
      <p className="mt-2 text-center text-sm text-neutral-500">
        Pick a duel type, then a mode.
      </p>

      <div className="mt-10 space-y-10">
        {DUEL_TYPES.map((duel) => (
          <section key={duel.key}>
            <h2 className="text-lg font-semibold">{duel.name}</h2>
            <p className="mt-1 text-sm text-neutral-500">{duel.description}</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {duel.modes.map((mode) =>
                mode.href ? (
                  <Link
                    key={mode.key}
                    href={mode.href}
                    className="rounded-xl border border-neutral-200 bg-white p-5 transition hover:border-neutral-900"
                  >
                    <h3 className="font-medium">{mode.name}</h3>
                    <p className="mt-1 text-sm text-neutral-500">
                      {mode.description}
                    </p>
                  </Link>
                ) : (
                  <div
                    key={mode.key}
                    className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-5 opacity-60"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">{mode.name}</h3>
                      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                        Coming soon
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">
                      {mode.description}
                    </p>
                  </div>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
