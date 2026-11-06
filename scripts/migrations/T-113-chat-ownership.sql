-- T-113: add a nullable conversation owner and lookup index.
-- MANUAL, REVIEW-ONLY UNTIL SEPARATELY APPROVED FOR THE TARGET DATABASE.
-- Do not run automatically during app startup, tests against a shared DB, deployment,
-- or by passing --force. Operational preparation and stop conditions are in
-- docs/design/T-113-chat-ownership-migration.md.
--
-- This file adds no assignment, update, deletion, backfill, or ownership assumption.
-- Historical conversations remain NULL and must be inaccessible to user-scoped API
-- code. This additive column does NOT secure an old application version: old API
-- code can still query and mutate records without owner predicates. Do not expose
-- the old application while asserting user isolation. Deployment and rollback
-- must explicitly account for every old app instance and in-flight request.
--
-- Deliberately NOT automatically idempotent: if either name already exists,
-- stop, inspect actual schema and outcome, and use the documented reconciliation
-- procedure. IF NOT EXISTS would hide an incompatible column or index. DDL can
-- implicitly commit; do not treat a transaction or code rollback as DDL rollback.
-- Never retry automatically after timeout, crash, ambiguous result or disconnection.
SET SESSION lock_wait_timeout = 5;

ALTER TABLE chat_threads
  ADD COLUMN user_id INT UNSIGNED NULL DEFAULT NULL,
  ADD INDEX idx_chat_threads_user_archived_updated (user_id, archived, updated_at);
