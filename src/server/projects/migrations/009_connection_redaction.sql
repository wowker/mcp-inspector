ALTER TABLE connections
ADD COLUMN redact_sensitive_info INTEGER NOT NULL DEFAULT 1
CHECK (redact_sensitive_info IN (0, 1));
