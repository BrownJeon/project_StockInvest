#!/usr/bin/env bash
# T-113: disposable, synthetic backup/restore DRILL ONLY; never uses an external DB.
# Docker must be local; no arguments, no external DB configuration, no port published.
set -Eeuo pipefail
if [[ $# -ne 0 ]]; then echo 'usage: run this drill without arguments' >&2; exit 2; fi
umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/t113-backup-drill.XXXXXXXX")
cid=''
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ "$rc" -ne 0 && -n "$cid" ]]; then docker logs --tail 15 "$cid" >&2 || true; fi
  if [[ -n "$cid" ]]; then docker rm -f "$cid" >/dev/null 2>&1 || rc=1; fi
  if [[ -d "$work/gnupg" ]]; then gpgconf --homedir "$work/gnupg" --kill gpg-agent >/dev/null 2>&1 || rc=1; fi
  rm -rf -- "$work" || rc=1
  exit "$rc"
}
trap cleanup EXIT INT TERM
# --pull never prevents network image pulls. Dummy data and empty root password
# are safe only inside this unique network-disabled temporary fixture.
cid=$(docker run -d --rm --pull never --network none --tmpfs /var/lib/mysql:rw,nosuid,size=256m --tmpfs /run/mysqld:rw,nosuid,size=16m -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 mariadb:10.11.11 --skip-networking)
for n in $(seq 1 60); do
  # Entrypoint starts a transient bootstrap server before its final server.
  if docker logs "$cid" 2>&1 | grep -q 'MariaDB init process done' && docker exec "$cid" mariadb-admin -uroot ping --silent >/dev/null 2>&1; then break; fi
  if [[ "$n" = 60 ]]; then echo 'fixture database did not become ready' >&2; exit 1; fi
  sleep 1
done
sql() { docker exec -i "$cid" mariadb -uroot --batch --skip-column-names "$@"; }
value() { sql -e "$1" | tr -d '\r'; }
assert_eq() { local label=$1 got=$2 want=$3; if [[ "$got" != "$want" ]]; then printf 'FAIL %s: expected %s, got %s\n' "$label" "$want" "$got" >&2; exit 1; fi; printf 'PASS %s\n' "$label"; }
sql <<'SQL'
CREATE DATABASE source_lab CHARACTER SET utf8mb4;
CREATE DATABASE restore_lab CHARACTER SET utf8mb4;
USE source_lab;
CREATE TABLE users (id INT UNSIGNED PRIMARY KEY, created_at DATETIME NOT NULL) ENGINE=InnoDB;
CREATE TABLE chat_threads (id BIGINT PRIMARY KEY, title VARCHAR(120) NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, message_count INT NOT NULL, archived TINYINT NOT NULL) ENGINE=InnoDB;
CREATE TABLE chat_messages (id BIGINT PRIMARY KEY, thread_id BIGINT NOT NULL, role VARCHAR(32) NOT NULL, content TEXT NOT NULL, created_at DATETIME NOT NULL, FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE) ENGINE=InnoDB;
INSERT INTO users VALUES (1,'2026-01-01 12:00:00');
INSERT INTO chat_threads VALUES (10,'SYNTHETIC-A','2026-02-01 10:00:00','2026-02-03 11:22:33',2,0),(20,'SYNTHETIC-B','2026-02-02 10:00:00','2026-02-04 11:22:33',1,1);
INSERT INTO chat_messages VALUES (101,10,'user','SYNTHETIC-QUESTION','2026-02-01 10:01:00'),(102,10,'assistant','SYNTHETIC-ANSWER','2026-02-01 10:02:00'),(201,20,'user','SYNTHETIC-ARCHIVED','2026-02-02 10:01:00');
SQL
# Snapshot only the two synthetic chat tables. User credentials/settings are never dumped.
docker exec "$cid" mariadb-dump -uroot --single-transaction --skip-lock-tables --skip-add-locks --skip-disable-keys --no-tablespaces source_lab chat_threads chat_messages > "$work/chat.sql"
chmod 600 "$work/chat.sql"
[[ -s "$work/chat.sql" ]] || { echo 'empty dump' >&2; exit 1; }
sha256sum "$work/chat.sql" | awk '{print "Synthetic dump SHA-256: " $1}'
# Synthetic-only symmetric encryption. Never read a user's GPG keyring or passphrase.
mkdir -m 700 "$work/gnupg"
head -c 32 /dev/urandom | base64 > "$work/passphrase"
gpg --no-options --homedir "$work/gnupg" --batch --yes --no-symkey-cache --pinentry-mode loopback --passphrase-file "$work/passphrase" --cipher-algo AES256 --symmetric --output "$work/chat.sql.gpg" "$work/chat.sql"
gpg --no-options --homedir "$work/gnupg" --batch --yes --no-symkey-cache --pinentry-mode loopback --passphrase-file "$work/passphrase" --decrypt --output "$work/decrypted.sql" "$work/chat.sql.gpg" 2>/dev/null
cmp -s "$work/chat.sql" "$work/decrypted.sql" || { echo 'FAIL encryption round trip' >&2; exit 1; }
echo 'PASS synthetic encryption round trip'
python3 - "$work/chat.sql.gpg" "$work/tampered.gpg" <<'PY'
import pathlib, sys
payload = bytearray(pathlib.Path(sys.argv[1]).read_bytes())
payload[-1] ^= 1
pathlib.Path(sys.argv[2]).write_bytes(payload)
PY
# GPG may emit plaintext before it reports a failed integrity check. Never import
# an output until decryption completed successfully; this failed file is synthetic.
if gpg --no-options --homedir "$work/gnupg" --batch --yes --no-symkey-cache --pinentry-mode loopback --passphrase-file "$work/passphrase" --decrypt --output "$work/rejected.sql" "$work/tampered.gpg" 2>/dev/null; then
  echo 'FAIL tampered ciphertext accepted' >&2; exit 1
fi
rm -f "$work/rejected.sql"
echo 'PASS tampered ciphertext rejected before import'
sql restore_lab < "$work/decrypted.sql"
# SQL comparisons return only counts; fixture rows are never printed.
assert_eq 'snapshot thread count' "$(value 'SELECT COUNT(*) FROM restore_lab.chat_threads')" 2
assert_eq 'snapshot message count' "$(value 'SELECT COUNT(*) FROM restore_lab.chat_messages')" 3
assert_eq 'restored thread fields and timestamps' "$(value "SELECT COUNT(*) FROM source_lab.chat_threads a LEFT JOIN restore_lab.chat_threads b ON a.id=b.id WHERE b.id IS NULL OR NOT(a.title<=>b.title AND a.created_at<=>b.created_at AND a.updated_at<=>b.updated_at AND a.message_count<=>b.message_count AND a.archived<=>b.archived)")" 0
assert_eq 'restored message fields and timestamps' "$(value "SELECT COUNT(*) FROM source_lab.chat_messages a LEFT JOIN restore_lab.chat_messages b ON a.id=b.id WHERE b.id IS NULL OR NOT(a.thread_id<=>b.thread_id AND a.role<=>b.role AND a.content<=>b.content AND a.created_at<=>b.created_at)")" 0
assert_eq 'restored foreign key exists' "$(value "SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='restore_lab' AND TABLE_NAME='chat_messages' AND COLUMN_NAME='thread_id' AND REFERENCED_TABLE_NAME='chat_threads'")" 1
# DDL is deliberately run after snapshot, then verify rollback cannot undo DDL.
sql source_lab <<'SQL'
START TRANSACTION;
ALTER TABLE chat_threads ADD COLUMN user_id INT UNSIGNED NULL DEFAULT NULL, ADD INDEX idx_chat_threads_user_archived_updated (user_id, archived, updated_at);
ROLLBACK;
SQL
assert_eq 'DDL persists beyond rollback' "$(value "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='source_lab' AND TABLE_NAME='chat_threads' AND COLUMN_NAME='user_id'")" 1
# Exact synthetic manifest tracks both before and after owner/time; no credentials or text.
sql source_lab <<'SQL'
CREATE TABLE synthetic_scope (id BIGINT PRIMARY KEY, before_owner INT UNSIGNED NULL, before_updated_at DATETIME NOT NULL, after_owner INT UNSIGNED NOT NULL, after_updated_at DATETIME NOT NULL) ENGINE=InnoDB;
INSERT INTO synthetic_scope SELECT id,user_id,updated_at,1,updated_at FROM chat_threads WHERE user_id IS NULL;
START TRANSACTION;
UPDATE chat_threads t JOIN synthetic_scope s ON s.id=t.id SET t.user_id=s.after_owner,t.updated_at=t.updated_at WHERE t.user_id IS NULL;
COMMIT;
SQL
assert_eq 'synthetic backfill exact IDs' "$(value 'SELECT COUNT(*) FROM source_lab.chat_threads t JOIN source_lab.synthetic_scope s USING(id) WHERE NOT(t.user_id<=>s.after_owner AND t.updated_at<=>s.after_updated_at)')" 0
# Simulate a post-backfill new conversation; guarded selective rollback must leave it untouched.
sql source_lab <<'SQL'
INSERT INTO chat_threads (id,title,created_at,updated_at,message_count,archived,user_id) VALUES (30,'SYNTHETIC-NEW','2026-03-01 10:00:00','2026-03-01 10:00:00',0,0,1);
SQL
# Introduce drift: rollback must be refused for the entire scope, not partially applied.
sql source_lab -e "UPDATE chat_threads SET user_id=2, updated_at='2026-04-01 09:00:00' WHERE id=20"
drift=$(value 'SELECT COUNT(*) FROM source_lab.synthetic_scope s LEFT JOIN source_lab.chat_threads t ON t.id=s.id WHERE t.id IS NULL OR NOT(t.user_id<=>s.after_owner AND t.updated_at<=>s.after_updated_at)')
assert_eq 'drift detected before restore' "$drift" 1
assert_eq 'drift abort leaves first row intact' "$(value 'SELECT user_id FROM source_lab.chat_threads WHERE id=10')" 1
# Reset synthetic drift to exercise a successful guarded rollback. This is test-only.
sql source_lab -e "UPDATE chat_threads t JOIN synthetic_scope s ON t.id=s.id SET t.user_id=s.after_owner,t.updated_at=s.after_updated_at WHERE t.id=20"
sql source_lab <<'SQL'
START TRANSACTION;
UPDATE chat_threads t JOIN synthetic_scope s ON t.id=s.id
 SET t.user_id=s.before_owner, t.updated_at=s.before_updated_at
 WHERE t.user_id <=> s.after_owner AND t.updated_at <=> s.after_updated_at;
COMMIT;
SQL
assert_eq 'selective owner restoration' "$(value 'SELECT COUNT(*) FROM source_lab.chat_threads t JOIN source_lab.synthetic_scope s USING(id) WHERE NOT(t.user_id<=>s.before_owner AND t.updated_at<=>s.before_updated_at)')" 0
assert_eq 'new row preserved' "$(value 'SELECT COUNT(*) FROM source_lab.chat_threads WHERE id=30 AND user_id=1')" 1
assert_eq 'messages preserved after rollback' "$(value 'SELECT COUNT(*) FROM source_lab.chat_messages')" 3
printf 'PASS disposable synthetic drill; production backup/restore and guarded writer exclusion NOT tested\n'
