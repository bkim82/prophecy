import { clerkClient } from "@clerk/nextjs/server";

// Opponents by Clerk @username, else first name (this instance doesn't
// collect usernames) — never a last name or email. Ids missing from the map
// (neither set, or the lookup failed) are the caller's "Opponent" fallback.
export async function opponentNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id !== null))];
  if (unique.length === 0) return new Map();
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({ userId: unique, limit: unique.length });
    return new Map(
      data.flatMap((user) => {
        const name = user.username ? `@${user.username}` : user.firstName;
        return name ? [[user.id, name]] : [];
      }),
    );
  } catch {
    return new Map();
  }
}
