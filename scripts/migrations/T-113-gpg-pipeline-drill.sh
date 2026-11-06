#!/usr/bin/env bash
# Synthetic-only pipeline rehearsal: local disposable MariaDB; no inputs or network.
set -Eeuo pipefail
[[ $# -eq 0 ]] || { echo 'no arguments allowed' >&2; exit 2; }
umask 077
work=$(mktemp -d /tmp/t113-gpg-pipeline.XXXXXXXX)
cid=''
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ -n "$cid" ]]; then docker rm -f "$cid" >/dev/null 2>&1 || rc=1; fi
  if [[ -d "$work/gnupg" ]]; then gpgconf --homedir "$work/gnupg" --kill gpg-agent >/dev/null 2>&1 || rc=1; fi
  rm -rf -- "$work" || rc=1
  exit "$rc"
}
trap cleanup EXIT INT TERM
cid=$(docker run -d --rm --pull never --network none --tmpfs /var/lib/mysql:rw,nosuid,size=256m --tmpfs /run/mysqld:rw,nosuid,size=16m -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 mariadb:10.11.11 --skip-networking)
for n in $(seq 1 60); do
  if docker logs "$cid" 2>&1 | grep -q 'MariaDB init process done' && docker exec "$cid" mariadb-admin -uroot ping --silent >/dev/null 2>&1; then break; fi
  [[ "$n" != 60 ]] || { echo 'fixture startup failed' >&2; exit 1; }
  sleep 1
done
sql() { docker exec -i "$cid" mariadb -uroot --batch --skip-column-names "$@"; }
sql <<'SQL'
CREATE DATABASE source_lab;
CREATE DATABASE restore_lab;
USE source_lab;
CREATE TABLE chat_threads (id INT PRIMARY KEY, title TEXT NOT NULL) ENGINE=InnoDB;
CREATE TABLE chat_messages (id INT PRIMARY KEY, thread_id INT NOT NULL, content TEXT NOT NULL, FOREIGN KEY(thread_id) REFERENCES chat_threads(id)) ENGINE=InnoDB;
INSERT INTO chat_threads VALUES (1,'SYNTHETIC'),(2,'SYNTHETIC-ARCHIVED');
INSERT INTO chat_messages VALUES (1,1,'SYNTHETIC-MESSAGE'),(2,2,'SYNTHETIC-REPLY');
SQL
mkdir -m 700 "$work/gnupg"
head -c 32 /dev/urandom | base64 > "$work/passphrase"
# Fixture-only passphrase; synthetic plaintext flows directly into encryption.
docker exec "$cid" mariadb-dump -uroot --single-transaction --skip-lock-tables --skip-add-locks --no-tablespaces source_lab chat_threads chat_messages |
  gpg --no-options --homedir "$work/gnupg" --batch --yes --no-symkey-cache --pinentry-mode loopback --passphrase-file "$work/passphrase" --cipher-algo AES256 --symmetric --output "$work/backup.gpg"
[[ -s "$work/backup.gpg" ]] || { echo 'empty cipher' >&2; exit 1; }
gpg --no-options --homedir "$work/gnupg" --batch --yes --no-symkey-cache --pinentry-mode loopback --passphrase-file "$work/passphrase" --decrypt --output "$work/verified.sql" "$work/backup.gpg" 2>/dev/null
sql restore_lab < "$work/verified.sql"
result=$(sql -e "SELECT (SELECT COUNT(*) FROM restore_lab.chat_threads)=2 AND (SELECT COUNT(*) FROM restore_lab.chat_messages)=2 AND NOT EXISTS (SELECT 1 FROM source_lab.chat_threads s LEFT JOIN restore_lab.chat_threads r ON r.id=s.id WHERE r.id IS NULL OR NOT(r.title<=>s.title)) AND NOT EXISTS (SELECT 1 FROM source_lab.chat_messages s LEFT JOIN restore_lab.chat_messages r ON r.id=s.id WHERE r.id IS NULL OR NOT(r.thread_id<=>s.thread_id AND r.content<=>s.content))")
[[ "$result" == 1 ]] || { echo 'fixture restore mismatch' >&2; exit 1; }
echo 'PASS direct dump-encryption pipeline and full synthetic restore comparison'
# A producer failure must be propagated by pipefail, even if encryption succeeds.
if (set -o pipefail; { printf 'synthetic partial dump'; exit 7; } | gpg --no-options --homedir "$work/gnupg" --batch --yes --no-symkey-cache --pinentry-mode loopback --passphrase-file "$work/passphrase" --cipher-algo AES256 --symmetric --output "$work/partial.gpg"); then
  echo 'failed producer was accepted' >&2; exit 1
fi
echo 'PASS producer failure propagates through encryption pipeline'
echo 'PASS synthetic only; no operating backup or key tested'
