CREATE TABLE admin_issues_lock (id INTEGER PRIMARY KEY);
INSERT INTO admin_issues_lock (id) VALUES (1);

CREATE TABLE admin_issues (
    id VARCHAR(36) PRIMARY KEY,
    fingerprint VARCHAR(64) NOT NULL UNIQUE,
    kind VARCHAR(32) NOT NULL,
    task_id VARCHAR(36),
    owner_id VARCHAR(36),
    channel_id VARCHAR(36),
    bucket_id VARCHAR(36),
    error_code VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('open', 'resolved')),
    occurrences BIGINT NOT NULL CHECK (occurrences > 0),
    first_seen BIGINT NOT NULL,
    last_seen BIGINT NOT NULL
);
CREATE INDEX admin_issues_last_seen ON admin_issues(last_seen);
CREATE INDEX admin_issues_status_last_seen ON admin_issues(status, last_seen);
