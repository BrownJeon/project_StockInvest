# T-012 publication — Leader receipt (before push)

- Actor: Claude Code 2.1.288, Mac ordinary main, same session `9447e8e7-0cc1-4687-978f-e226a32aa245` (resumed), `--agent leader`, permission-mode auto, existing hooks. Acceptance: `acceptance.json`.
- User authorization (quoted via coordinator): “직압에 대해서 커밋 및 푸시해서 운영에도 배포해줘”. Not re-asked.

## Preflight (observed 2026-11-10 ~17:18–17:35 KST, home_ubuntu)
- origin main = `06bce08a7939ac17009194995fc6f0da6f99f239` (git ls-remote); current symlink → `releases/20261109-002723-06bce08a`; last webhook RELEASE_RESULT ok for that SHA, END exit=0.
- pm2 (selected fields only): `stockinvest` online cluster restarts 0, `stockinvest-cron` online fork restarts 0, both cwd = current release; exactly one cron. `/api/health` 200. Deployed package version 0.1.0.
- Deploy path: Gitea webhook `project_StockInvest` → `deploy-stockinvest.sh` → `release.sh deploy` blue/green (no `--migrate`). No docs-only skip: every push to main = full build+deploy. Inflight push is skipped, so exactly ONE push. No Gitea Actions runner observed (no act_runner process/container) → `.gitea/workflows/deploy.yml` (old NFS reset flow) is not executed. No manual `deploy.sh` will be run.
- Shared NFS checkout: HEAD `ebbcdca` (behind origin), 121 dirty/untracked entries of other work → NOT used. Publication from isolated clean clone `~/.node-local/stockinvest-t012-pub-20261110` (ext4) with project hooks installed (`core.hooksPath=scripts/git-hooks`, commit-msg executable).

## Market window
- Client time 2026-11-10 (Tue) ~17:3x KST. KRX regular session closed (15:30). US regular session (23:30 KST after DST end) not open; US pre-market starts ~18:00 KST. Deploy expected to complete in ~2–4 min. blue/green reload restarts cron process briefly; no trading pause invented, KILL_SWITCH/dryRun untouched.

## Change / impact
- App source: none. T-012 code already in deployed release (verified by final-verification QA 198/198, tsc 0 against this release).
- Commit contents: package.json/package-lock.json version 0.1.0→0.2.0 (web only; native versionCode/APK untouched); T-012 task file appended T-012 records (pure append vs origin, 648+/0-); roadmap 2 T-012 entries annotated + updated date; ACTIVE own T-012 entry; `docs/handovers/T-012-final-verification-20261109/**` (without @eaDir); this publication dir (handoff/scope/roles/acceptance/leader).
- Impact: new release dir built from origin, pm2 reload of stockinvest + stockinvest-cron. No migration, DB write, forced snapshot, KIS/token/order.

## Recovery
- build_failed → current unchanged. health_failed → release.sh auto-rollback. Manual rollback (`release.sh rollback`) only under user instruction. Version metadata change is behaviour-neutral.

## Unknowns
- Authenticated UI behaviour after reload is not exercised by this deploy (health/HTML only).
- Safety-setting equality will be checked by metadata/hash only, values not printed.

## Scope adjustments decided by Leader during preparation (recorded before push)
- `docs/handovers/T-012-final-verification-20261109/review-source/**/*.ts` (18 normalized views) and `supplemental-review/db-t012-wiring.ts` are NOT committed: tsconfig `include: **/*.ts` (excludes only tests) would make `next build` type-check partial excerpt views (db.ts/engine.ts) inside the release and risk `build_failed`. Their sha256 remain recorded in committed `review-source-index.json` / `scope-extension.json`; files stay on NFS. Changing tsconfig was rejected (product config change).
- `docs/handovers/T-012-final-verification-20261109/out/**` is git-ignored (`.gitignore: out/`); not force-added. The same Reviewer/QA/Leader receipts were already published into the T-012 task file sections that are committed. Raw `out/` JSON stays on NFS uncommitted.
- `@eaDir` Synology metadata excluded.
