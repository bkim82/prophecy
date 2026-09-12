<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Commit policy

Never run `git commit`, `git push`, or any command that creates/amends a commit without asking the user first, every time — a prior approval does not carry forward. Staging (`git add`) and showing a diff for review is fine without asking.

## Docs orchestration

`docs/` (indexed by `docs/README.md`, not linked from the root README) is an agent-facing fact sheet, not human docs: flat bullets, `file:line` refs, no narration. When a change to `app/**` alters behavior a doc describes:

1. Find the doc via the list in `docs/README.md`.
2. Update only the affected lines/refs — don't re-narrate the whole file.
3. New capability with no home → add one row to `docs/roadmap.md`'s "Not built" or a new doc + table row, whichever is smaller.
4. Prefer fixing a stale `file:line` ref over adding a sentence explaining what changed.

Skip this for refactors that don't change behavior (renames, formatting).
