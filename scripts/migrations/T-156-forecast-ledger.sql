-- Private forecast-only ledger. No mutation of paper account, live trading or source datasets.
CREATE TABLE IF NOT EXISTS t156_forecast_job (
 id CHAR(64) PRIMARY KEY, account_id VARCHAR(100) NOT NULL, status VARCHAR(24) NOT NULL,
 lease_token CHAR(64) NULL, lease_until DATETIME(6) NULL, completed_paths INT NOT NULL DEFAULT 0,
 issue_code VARCHAR(120) NULL, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS t156_forecast_run (
 id CHAR(64) PRIMARY KEY, job_id CHAR(64) NOT NULL UNIQUE, account_id VARCHAR(100) NOT NULL,
 issued_at DATETIME(6) NOT NULL, input_sha256 CHAR(64) NOT NULL, result_sha256 CHAR(64) NOT NULL, source_proof_json LONGTEXT NOT NULL CHECK(JSON_VALID(source_proof_json)),
 input_json LONGTEXT NOT NULL CHECK(JSON_VALID(input_json)), result_json LONGTEXT NOT NULL CHECK(JSON_VALID(result_json)),
 created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
 FOREIGN KEY(job_id) REFERENCES t156_forecast_job(id), INDEX(account_id,issued_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS t156_forecast_horizon (
 run_id CHAR(64) NOT NULL, horizon VARCHAR(12) NOT NULL, target_session DATE NOT NULL,
 result_json LONGTEXT NOT NULL CHECK(JSON_VALID(result_json)), PRIMARY KEY(run_id,horizon),
 FOREIGN KEY(run_id) REFERENCES t156_forecast_run(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS t156_forecast_evaluation (
 id CHAR(64) PRIMARY KEY, run_id CHAR(64) NOT NULL, horizon VARCHAR(12) NOT NULL,
 forecast_sha256 CHAR(64) NOT NULL, status VARCHAR(24) NOT NULL,
 result_json LONGTEXT NOT NULL CHECK(JSON_VALID(result_json)), created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
 FOREIGN KEY(run_id,horizon) REFERENCES t156_forecast_horizon(run_id,horizon), INDEX(run_id,created_at)
) ENGINE=InnoDB;
CREATE TRIGGER IF NOT EXISTS t156_forecast_run_no_update BEFORE UPDATE ON t156_forecast_run FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forecast ledger immutable';
CREATE TRIGGER IF NOT EXISTS t156_forecast_run_no_delete BEFORE DELETE ON t156_forecast_run FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forecast ledger immutable';
CREATE TRIGGER IF NOT EXISTS t156_forecast_horizon_no_update BEFORE UPDATE ON t156_forecast_horizon FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forecast ledger immutable';
CREATE TRIGGER IF NOT EXISTS t156_forecast_horizon_no_delete BEFORE DELETE ON t156_forecast_horizon FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forecast ledger immutable';
CREATE TRIGGER IF NOT EXISTS t156_forecast_eval_no_update BEFORE UPDATE ON t156_forecast_evaluation FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forecast ledger immutable';
CREATE TRIGGER IF NOT EXISTS t156_forecast_eval_no_delete BEFORE DELETE ON t156_forecast_evaluation FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forecast ledger immutable';
CREATE TABLE IF NOT EXISTS t156_forecast_continuation (
 account_id VARCHAR(100) NOT NULL, revision_after BIGINT NOT NULL, cycle_id VARCHAR(100) NOT NULL UNIQUE,
 before_sha256 CHAR(64) NOT NULL, after_sha256 CHAR(64) NOT NULL,
 receipt_sha256 CHAR(64) NOT NULL, receipt_json LONGTEXT NOT NULL CHECK(JSON_VALID(receipt_json)),
 created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)), PRIMARY KEY(account_id,revision_after)
) ENGINE=InnoDB;
CREATE TRIGGER IF NOT EXISTS t156_forecast_continuation_no_update BEFORE UPDATE ON t156_forecast_continuation FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forecast ledger immutable';
CREATE TRIGGER IF NOT EXISTS t156_forecast_continuation_no_delete BEFORE DELETE ON t156_forecast_continuation FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forecast ledger immutable';
