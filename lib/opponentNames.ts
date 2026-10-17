import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { botNames } from "@/lib/bots";

// Opponents by Prophecy @handle, else display name. House bots (lib/bots.ts)
// resolve from their persona name. Ids missing from the map use the caller's
// "Opponent" fallback.
export async function opponentNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const bots = await botNames(unique).catch(() => new Map<string, string>());
  const humans = unique.filter((id) => !bots.has(id));
  if (humans.length === 0) return bots;
  try {
    const rows = await getDb()
      .select({ userId: profiles.userId, handle: profiles.handle, displayName: profiles.displayName })
      .from(profiles)
      .where(inArray(profiles.userId, humans));
    return new Map([
      ...bots,
      ...rows.flatMap((profile) => {
        const name = profile.handle ? `@${profile.handle}` : profile.displayName;
        return name ? [[profile.userId, name] as const] : [];
      }),
    ]);
  } catch {
    return bots;
  }
}
