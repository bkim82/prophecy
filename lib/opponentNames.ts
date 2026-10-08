import { clerkClient } from "@clerk/nextjs/server";
import { botNames } from "@/lib/bots";

// Opponents by Clerk @username, else first name (this instance doesn't
// collect usernames) — never a last name or email. House bots (lib/bots.ts)
// resolve from their persona name in the same shapes. Ids missing from the
// map (neither set, or the lookup failed) are the caller's "Opponent" fallback.
export async function opponentNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id !== null))];
  if (unique.length === 0) return new Map();
  const bots = await botNames(unique).catch(() => new Map<string, string>());
  const humans = unique.filter((id) => !bots.has(id));
  if (humans.length === 0) return bots;
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({ userId: humans, limit: humans.length });
    return new Map([
      ...bots,
      ...data.flatMap((user) => {
        const name = user.username ? `@${user.username}` : user.firstName;
        return name ? [[user.id, name] as const] : [];
      }),
    ]);
  } catch {
    return bots;
  }
}
