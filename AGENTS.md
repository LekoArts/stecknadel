What the app is and its stack: README.md.

Iterate with `pnpm typecheck`, `pnpm lint` and the Vitest files for the changed code (`pnpm exec vitest run <files>`); the user tries changes in `pnpm dev`. Commit each fix on its own; push a batch, not each fix.
Before pushing to `main` or opening a PR, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:native`, `pnpm test:e2e`, then a review. After pushing, share the CI run link and don't wait; check it before the next push.

e2e runs against the packaged app, not the dev build. Rebuild after source changes: `pnpm build && pnpm exec electron-builder --dir --mac --arm64 -c.mac.identity=null`.
Focused spec: `pnpm exec playwright test --project=packaged-dir e2e/<name>.spec.ts`.
`pnpm test:native` runs the tests that call the real ExifTool binary. Fixtures: `pnpm fixtures` (pinned downloads), `pnpm make-fixtures` (generated JPEGs), `pnpm make-demo` (a made-up trip with a GPX and a photo folder covering the app's cases, for trying flows by hand; the cases are listed in `scripts/make-demo.mjs`).
Real-data specs live in gitignored `e2e/local/` and `test/live/`. They need `STECKNADEL_LOCAL=1`, samples in `~/Downloads/stecknadel-samples`, and Dawarich credentials from `~/.config/stecknadel/dev.env` (`set -a; . ~/.config/stecknadel/dev.env; set +a`). Run them with `--project=local`.

The repo is public. Never commit real photos, location history, camera serial numbers, Dawarich URLs or keys, or `.mastracode/`. Never print the Dawarich URL or API key. Copy real samples to a temp folder before a test touches them; never write to the originals. Committed tests use the CC0 fixtures, the synthetic GPX, and fabricated serials and coordinates.
