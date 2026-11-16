CREATE TABLE runtime_lock (id INTEGER PRIMARY KEY, key_probe TEXT);
INSERT INTO runtime_lock (id) VALUES (1);
CREATE TABLE tasks (
    id VARCHAR(36) PRIMARY KEY,
    owner_id VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
    request_hash VARCHAR(64) NOT NULL,
    task_json TEXT NOT NULL,
    snapshot TEXT,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL
);
CREATE INDEX tasks_owner_created ON tasks(owner_id, created_at);
CREATE INDEX tasks_status_created ON tasks(status, created_at);
CREATE TABLE images (
    id VARCHAR(36) PRIMARY KEY,
    task_id VARCHAR(36) NOT NULL REFERENCES tasks(id),
    owner_id VARCHAR(64) NOT NULL,
    url VARCHAR(200) NOT NULL UNIQUE,
    bytes BIGINT NOT NULL,
    image_json TEXT NOT NULL
);
CREATE INDEX images_owner ON images(owner_id);
CREATE INDEX images_task ON images(task_id);
CREATE TABLE deleted_tasks (id VARCHAR(36) PRIMARY KEY, owner_id VARCHAR(64) NOT NULL);
CREATE TABLE file_deletions (url VARCHAR(200) PRIMARY KEY);
