#!/bin/bash
set -eu

for variable in AUTH_DB_PASSWORD LEDGER_DB_PASSWORD SYNC_DB_PASSWORD; do
  value="${!variable:-}"
  case "$value" in
    ''|*[!A-Za-z0-9_.@#-]*) echo "$variable must use only letters, numbers, period, underscore, @, #, or hyphen" >&2; exit 1 ;;
  esac
done

mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS splitease_auth CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS splitease_ledger CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS splitease_sync CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'auth_app'@'%' IDENTIFIED BY '${AUTH_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'ledger_app'@'%' IDENTIFIED BY '${LEDGER_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'sync_app'@'%' IDENTIFIED BY '${SYNC_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON splitease_auth.* TO 'auth_app'@'%';
GRANT ALL PRIVILEGES ON splitease_ledger.* TO 'ledger_app'@'%';
GRANT ALL PRIVILEGES ON splitease_sync.* TO 'sync_app'@'%';
SQL