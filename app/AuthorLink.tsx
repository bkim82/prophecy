import Link from "next/link";
import { profileHref } from "@/app/lib/profiles";

// Author name that links to their profile (`profileHref`: when `account` says
// the handle is a real account's), or to `href` when the caller knows better
// ("/profile" for your own); bots and accounts without a handle stay plain text.
export function AuthorLink({
  handle,
  name,
  account = false,
  href = profileHref(handle, account),
}: {
  handle: string;
  name: string;
  account?: boolean;
  href?: string;
}) {
  return href ? (
    <Link href={href} className="author-link">
      <strong>{name}</strong>
    </Link>
  ) : (
    <strong>{name}</strong>
  );
}
