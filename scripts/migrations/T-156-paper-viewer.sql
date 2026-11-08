-- Explicit operator binding only. Intentionally no INSERT/backfill/default owner.
-- Applying this schema does not authorize a viewer. UTC timestamp.
CREATE TABLE IF NOT EXISTS t156_paper_viewer (
 account_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id INT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT UTC_TIMESTAMP(6),
 CONSTRAINT fk_t156_paper_viewer_account FOREIGN KEY (account_id) REFERENCES t156_paper_account(id),
 CONSTRAINT fk_t156_paper_viewer_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
