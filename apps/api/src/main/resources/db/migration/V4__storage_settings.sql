CREATE TABLE r2_buckets (
    id VARCHAR(36) PRIMARY KEY,
    account_id VARCHAR(32) NOT NULL,
    bucket_name VARCHAR(63) NOT NULL,
    jurisdiction VARCHAR(16) NOT NULL CHECK (jurisdiction IN ('default','eu','fedramp')),
    access_key_id_cipher TEXT NOT NULL,
    secret_access_key_cipher TEXT NOT NULL,
    analytics_token_cipher TEXT,
    UNIQUE (account_id, bucket_name, jurisdiction)
);
ALTER TABLE site_settings ADD COLUMN active_bucket_id VARCHAR(36) REFERENCES r2_buckets(id);
ALTER TABLE site_settings ADD COLUMN retention_days INTEGER CHECK (retention_days IS NULL OR retention_days BETWEEN 1 AND 3650);
