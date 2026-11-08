-- T-156: additive analysis/research archive. Apply explicitly; never run at app boot.
-- Existing trading, prices, settings and validation rows are not modified.
-- *_at columns below contain UTC wall-clock strings (not the legacy KST convention).
-- Clients bind UTC strings and SELECT DATE_FORMAT(...), avoiding mysql2 Date conversion.
-- Rollback is withdrawal: change a new dataset status to 'rejected'. Do not DROP
-- referenced history or restore an old full production database over newer writes.

CREATE TABLE IF NOT EXISTS t156_dataset (
  id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  kind VARCHAR(64) CHARACTER SET ascii NOT NULL,
  source_key VARCHAR(190) NOT NULL,
  status ENUM('staged','published','rejected') NOT NULL DEFAULT 'staged',
  live_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  metadata_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY idx_dataset_source (kind,source_key),
  KEY idx_dataset_status (status,live_eligible)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t156_record (
  dataset_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_key VARCHAR(190) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_date DATE NULL,
  symbol VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  available_at DATETIME(6) NULL,
  payload_json JSON NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (dataset_id,record_type,record_key),
  KEY idx_record_session (dataset_id,record_type,session_date),
  KEY idx_record_symbol (dataset_id,symbol,session_date),
  KEY idx_record_availability (dataset_id,available_at),
  CONSTRAINT fk_t156_record_dataset FOREIGN KEY (dataset_id) REFERENCES t156_dataset(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t156_blob (
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  byte_length BIGINT UNSIGNED NOT NULL,
  part_count INT UNSIGNED NOT NULL,
  encoding VARCHAR(32) CHARACTER SET ascii NOT NULL DEFAULT 'binary'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t156_blob_part (
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  part_no INT UNSIGNED NOT NULL,
  part_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bytes MEDIUMBLOB NOT NULL,
  PRIMARY KEY (sha256,part_no),
  CONSTRAINT fk_t156_blob_part FOREIGN KEY (sha256) REFERENCES t156_blob(sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t156_test_artifact (
  artifact_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  filename VARCHAR(512) NOT NULL,
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(64) CHARACTER SET ascii NOT NULL,
  metadata_json JSON NOT NULL,
  CONSTRAINT fk_t156_artifact_blob FOREIGN KEY (sha256) REFERENCES t156_blob(sha256),
  KEY idx_artifact_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t156_analysis_run (
  run_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  idempotency_key VARCHAR(190) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_date DATE NOT NULL,
  decision_at DATETIME(6) NOT NULL,
  policy_version VARCHAR(96) CHARACTER SET ascii NOT NULL,
  input_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  input_json JSON NOT NULL,
  plan_json JSON NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_t156_analysis_idempotency (idempotency_key),
  KEY idx_analysis_session (session_date,policy_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t156_judgment (
  run_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  stage VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii NOT NULL,
  payload_json JSON NOT NULL,
  PRIMARY KEY (run_id,stage,event_hash),
  KEY idx_judgment_event (stage,event_hash),
  CONSTRAINT fk_t156_judgment_run FOREIGN KEY (run_id) REFERENCES t156_analysis_run(run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t156_signal_draft (
  run_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  symbol VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  side ENUM('buy','sell') NOT NULL,
  payload_json JSON NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii NOT NULL DEFAULT 'shadow',
  PRIMARY KEY (run_id,symbol,side),
  CONSTRAINT fk_t156_draft_run FOREIGN KEY (run_id) REFERENCES t156_analysis_run(run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
