-- T-156 forward evaluation only. No modifications to trading/account tables.
-- UTC DATETIME; private account copies are never returned by the public inventory.
CREATE TABLE IF NOT EXISTS t156_paper_account (
  id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  status ENUM('active','paused') NOT NULL DEFAULT 'paused',
  policy_json JSON NOT NULL,
  clone_json JSON NOT NULL,
  state_json JSON NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  lease_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_until DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t156_paper_cycle (
  id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  account_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_date DATE NOT NULL,
  decision_at DATETIME(6) NOT NULL,
  mode ENUM('rehearsal','forward','blocked') NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_paper_cycle_session (account_id,session_date,mode),
  CONSTRAINT fk_paper_cycle_account FOREIGN KEY (account_id) REFERENCES t156_paper_account(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t156_paper_signal (
  id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  account_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cycle_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_date DATE NOT NULL,
  symbol VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  side ENUM('buy','sell') NOT NULL,
  execution_scope ENUM('paper_only') NOT NULL DEFAULT 'paper_only',
  status ENUM('rehearsal','awaiting_open','filled','expired','blocked') NOT NULL,
  intent_json JSON NOT NULL,
  outcome_json JSON NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_paper_signal_intent (account_id,session_date,symbol,side),
  CONSTRAINT fk_paper_signal_account FOREIGN KEY (account_id) REFERENCES t156_paper_account(id),
  CONSTRAINT fk_paper_signal_cycle FOREIGN KEY (cycle_id) REFERENCES t156_paper_cycle(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
