import Link from "next/link";
import { profileHref } from "@/app/lib/mockProfiles";

// Author name that links to /profile/[handle] when that handle has a mock
// profile; bots and unknown handles stay plain text.
export function AuthorLink({ handle, name }: { handle: string; name: string }) {
  const href = profileHref(handle);
  return href ? (
    <Link href={href} className="author-link">
      <strong>{name}</strong>
    </Link>
  ) : (
    <strong>{name}</strong>
  );
}
