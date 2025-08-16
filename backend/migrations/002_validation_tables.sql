-- Migration 002: validation tables (idempotent guards recommended at runtime)
CREATE TABLE IF NOT EXISTS validation_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  validated INTEGER NOT NULL,
  severity TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE
);
