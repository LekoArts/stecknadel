# AGENTS.md

What the app is and its stack: [README.md](README.md). How the UI should look, read and behave: [DESIGN.md](DESIGN.md).

## Working loop

- While iterating, run only `pnpm typecheck`, `pnpm lint` and the Vitest files for the code you changed (`pnpm exec vitest run <files>`). The user tries changes in `pnpm dev`.
- Commit each fix on its own. Push a batch when it's done, not each fix.
- Run the full pass only right before pushing to `main` or opening a PR: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:native`, the packaged e2e suite, and a review.
- After pushing, don't wait for CI. Share the run link and check it before the next push.

## Tests

- e2e runs against the packaged app, not the dev build. Rebuild it after every source change: `pnpm build && pnpm exec electron-builder --dir --mac --arm64 -c.mac.identity=null`.
- One spec: `pnpm exec playwright test --project=packaged-dir e2e/<name>.spec.ts`. All: `pnpm test:e2e`.
- `pnpm test:native` runs the tests that call the real ExifTool binary. Fixtures: `pnpm fixtures` (pinned downloads), `pnpm make-fixtures` (generated JPEGs).
- Real-data specs live in `e2e/local/` and `test/live/` (gitignored). They need `STECKNADEL_LOCAL=1`, the user's samples in `~/Downloads/stecknadel-samples`, and Dawarich credentials loaded from `~/.config/stecknadel/dev.env` (`set -a; . ~/.config/stecknadel/dev.env; set +a`).

## Privacy (the repo is public)

- Never commit real photos, location history, camera serial numbers, Dawarich URLs or keys, or `.mastracode/`.
- Never print the Dawarich URL or API key. Copy real samples to a temp folder before a test touches them; never write to the originals.
- Committed tests use the CC0 fixtures, the synthetic GPX and fabricated serials and coordinates.
