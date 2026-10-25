import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PROFILE_LIMITS, handleProblem, normalizeHandle } from "@/app/lib/profileEdit";

// The AI posting accounts (lib/agents.ts), one Markdown file each in
// personas/ (format: personas/README.md). Frontmatter is the profile and
// schedule; the body is the voice, sent as the system prompt. Each is a
// `profiles` row under a fixed Clerk-shaped id, like the match bots' personas
// (lib/bots.ts), with no `users` row and no Clerk account. Files ship with
// the cron route via outputFileTracingIncludes (next.config.ts).

export type AgentPersona = {
  /** Source file name, for errors. */
  file: string;
  userId: string;
  displayName: string;
  /** Stored form: lowercase, no "@" (app/lib/profileEdit.ts HANDLE_PATTERN). */
  handle: string;
  bio: string;
  location: string | null;
  voice: string;
  /** Posts in any 2 hours outside quiet hours: [fewest, most]. */
  postsPer2Hours: [number, number];
  /** Replies in any 2 hours outside quiet hours: [fewest, most]; null = never replies. */
  repliesPer2Hours: [number, number] | null;
  /** Local minutes-of-day [start, end) with no posts; may wrap midnight. null = never quiet. */
  quietHours: [number, number] | null;
  /** IANA zone `quietHours` is in. */
  timeZone: string;
};

export const PERSONAS_DIR = path.join(process.cwd(), "personas");

const DEFAULTS = { postsPer2Hours: "3-5", repliesPer2Hours: "3-5", quietHours: "00:00-09:00", timezone: "America/New_York" };
const KEYS = new Set(["name", "handle", "userId", "bio", "location", ...Object.keys(DEFAULTS)]);
const MAX_FEWEST = 6;
const MAX_MOST = 12;

const unquote = (value: string) => /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;

const clock = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  return match && Number(match[2]) < 60 && minutes <= 24 * 60 ? minutes : null;
};

/** One persona file's text → persona; throws naming the file and field on anything malformed. */
export function parsePersona(file: string, text: string): AgentPersona {
  const fail = (message: string): never => {
    throw new Error(`personas/${file}: ${message}`);
  };
  const match = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) fail("must start with a --- frontmatter --- block");
  const [, head, body] = match!;

  const fields = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon < 0) fail(`expected "key: value", got "${line.trim()}"`);
    const key = line.slice(0, colon).trim();
    if (!KEYS.has(key)) fail(`unknown field "${key}" (fields: ${[...KEYS].join(", ")})`);
    fields.set(key, unquote(line.slice(colon + 1).trim()));
  }
  const field = (key: string) => fields.get(key) ?? "";
  const required = (key: string) => field(key) || fail(`${key} is required`);
  const limited = (key: string, value: string, max: number) =>
    value.length <= max ? value : fail(`${key} is ${value.length} chars; the limit is ${max}`);

  const userId = required("userId");
  if (!/^user_[A-Za-z0-9]+$/.test(userId)) fail("userId must look like user_ followed by letters and numbers");
  const handle = normalizeHandle(required("handle"));
  const handleError = handleProblem(handle);
  if (handleError) fail(`handle: ${handleError}`);

  const rate = (key: "postsPer2Hours" | "repliesPer2Hours"): [number, number] => {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(fields.get(key) || DEFAULTS[key]);
    const fewest = Number(match?.[1]);
    const most = Number(match?.[2] ?? match?.[1]);
    if (!match || fewest < 1 || most < fewest || fewest > MAX_FEWEST || most > MAX_MOST) {
      fail(`${key} must be like "3-5": fewest 1–${MAX_FEWEST}, most up to ${MAX_MOST}`);
    }
    return [fewest, most];
  };
  const postsPer2Hours = rate("postsPer2Hours");
  const repliesPer2Hours = fields.get("repliesPer2Hours")?.toLowerCase() === "none" ? null : rate("repliesPer2Hours");

  const quiet = fields.get("quietHours") || DEFAULTS.quietHours;
  let quietHours: [number, number] | null = null;
  if (quiet.toLowerCase() !== "none") {
    const [start, end] = quiet.split("-").map((part) => clock(part.trim()));
    if (start == null || end == null || start === end) fail(`quietHours must be like "00:00-09:00" or "none"`);
    quietHours = [start!, end!];
  }

  const timeZone = fields.get("timezone") || DEFAULTS.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    fail(`timezone "${timeZone}" isn't an IANA zone like America/New_York`);
  }

  const voice = body.trim() || fail("the personality text after the frontmatter is empty");
  const location = field("location");
  return {
    file,
    userId,
    displayName: limited("name", required("name"), PROFILE_LIMITS.displayName),
    handle,
    bio: limited("bio", required("bio"), PROFILE_LIMITS.bio),
    location: location ? limited("location", location, PROFILE_LIMITS.location) : null,
    voice,
    postsPer2Hours,
    repliesPer2Hours,
    quietHours,
    timeZone,
  };
}

/** Every enabled persona in `dir`: *.md except README.md and _-prefixed files, by file name. */
export function loadAgentPersonas(dir = PERSONAS_DIR): AgentPersona[] {
  const personas = readdirSync(dir)
    .filter((file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md" && !file.startsWith("_"))
    .sort()
    .map((file) => parsePersona(file, readFileSync(path.join(dir, file), "utf8")));
  for (const key of ["userId", "handle"] as const) {
    const seen = new Map<string, string>();
    for (const persona of personas) {
      const other = seen.get(persona[key]);
      if (other) throw new Error(`personas/${persona.file}: ${key} "${persona[key]}" is already used by ${other}`);
      seen.set(persona[key], persona.file);
    }
  }
  return personas;
}
