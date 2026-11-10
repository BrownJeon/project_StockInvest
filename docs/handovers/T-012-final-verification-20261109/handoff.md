# T-012 independent final verification
User authorizes final independent Reviewer and QA verification and matching roadmap/TASK state.
Ordinary Claude Code main-stage ownership handoff, distinct from the tools=0 external-review broker. Keep normal hooks and permissions; do not call/change broker, guards, switches, pins or add automation.
Accept explicitly in out/acceptance.json (task, release, accepted=true, scope). Write out/leader.md with actual Claude Code tool and acceptance; publish own receipt via fixed wrapper. Coordinator updates common execution_context after actual acceptance.
Target release 20261109-002723-06bce08a; last original followup0ba652e. Verify current deployed selected code. Do not fabricate missing historical receipts.
Archive metadata already confirms fixed targets12+4 archived, remaining0+0, matching completion markers. No live DB/archives/old task/financial data reads.
Allowed model reads: handoff.md, manifest.json, review-source-index.json, review-source/**, out/*-result.json and own/new role receipts. No snapshot/** reads or raw logs, original repo task/history/.env, company/inactive projects. Review source is AST comments-removed; two test views redact historical numeric fixtures. Executable snapshot remains unchanged and is tested under pinned hashes.
Delegate independent Reviewer FIRST. They inspect selected views and write out/reviewer.md and reviewer.json with actual Claude tool, scope, severity/path/grounds, verdict and limits. Wait for their findings.
Then a SEPARATE QA agent must actually execute these fixed operations (not Leader):
ssh home_ubuntu python3 /home/brownjeon/.node-local/stockinvest-t012-final-20261109/run-t012.py integrity
ssh home_ubuntu python3 /home/brownjeon/.node-local/stockinvest-t012-final-20261109/run-t012.py jest
ssh home_ubuntu python3 /home/brownjeon/.node-local/stockinvest-t012-final-20261109/run-t012.py typecheck
Wrapper uses minimal bwrap/no network or credentials/production mounts and flock/nice. No product edits, migrations, token/order/KIS, services/cron, Git commit/push, installs/build/deploy.
Reviewer criteria: exact cleanup lists and separate round markers, archive merge/retry/delete match/affectedRows; incomplete balances default throw, portfolio/cron partial policy and dashboard no snapshot writes; zero-price/allowlist/holding-vanished guards; freshness warning/critical/recovery/session; kill-switch freshness+baseline; engine unknown must avoid reconcile([]). Distinguish original-task blockers from later unrelated changes.
QA writes out/qa.md and qa.json with actual commands, returned counts and limitations, read-only safety and verdict. A harness/infrastructure failure is incomplete unless reproduced as product error. Request a precisely scoped harness repair rather than altering product code.
Each actor publishes own md before ending using:
ssh home_ubuntu python3 /home/brownjeon/.node-local/stockinvest-t012-final-20261109/run-t012.py publish <leader|reviewer|qa>
No need to read old task to append. Own receipt may not include actual financial values or identifiers.
Leader writes out/final.json with independent receipt paths, actual counts, blockers and done/review recommendation. This is a new current verification, not recovery of historical QA. No app release/build is made so new app-version policy requires no bump.

Execution route: actual ordinary Claude main runs on the Mac in existing TheAdmin project settings/hooks. Read this safe shared review kit; do not use the expired Ubuntu Claude login. Ubuntu runs only the fixed no-network test wrapper, not the Claude provider. Write receipts in this shared out directory. No authentication credentials are copied or changed.
