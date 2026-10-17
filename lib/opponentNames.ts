import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";

// Opponents by Prophecy @handle, else display name. Ids missing from the map
// use the caller's "Opponent" fallback.
export async function opponentNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();

  try {
    const rows = await getDb()
      .select({ userId: profiles.userId, handle: profiles.handle, displayName: profiles.displayName })
      .from(profiles)
      .where(inArray(profiles.userId, unique));

    return new Map(
      rows.flatMap((profile) => {
        const name = profile.handle ? `@${profile.handle}` : profile.displayName;
        return name ? [[profile.userId, name] as const] : [];
      }),
    );
  } catch {
    return new Map();
  }
}
