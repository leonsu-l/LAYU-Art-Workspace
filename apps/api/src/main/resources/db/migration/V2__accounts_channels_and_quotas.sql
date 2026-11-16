CREATE TABLE app_users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(512) NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('USER','ADMIN')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    daily_limit INTEGER,
    invite_id VARCHAR(36),
    created_at VARCHAR(40) NOT NULL,
    CHECK (daily_limit IS NULL OR daily_limit >= -1)
);
CREATE TABLE invite_codes (
    id VARCHAR(36) PRIMARY KEY,
    code VARCHAR(128) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(36) NOT NULL REFERENCES app_users(id),
    created_at VARCHAR(40) NOT NULL
);
CREATE TABLE login_sessions (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
    expires_at BIGINT NOT NULL
);
CREATE INDEX login_sessions_user ON login_sessions(user_id);
CREATE TABLE channels (
    id VARCHAR(36) PRIMARY KEY,
    owner_id VARCHAR(36) REFERENCES app_users(id),
    name VARCHAR(120) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    base_url VARCHAR(2048) NOT NULL,
    secret_cipher TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    enabled_models_json TEXT NOT NULL,
    catalog_json TEXT NOT NULL,
    catalog_updated_at BIGINT,
    catalog_error VARCHAR(512),
    revision INTEGER NOT NULL DEFAULT 1,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL
);
CREATE INDEX channels_owner ON channels(owner_id);
CREATE TABLE parameter_templates (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    params_json TEXT NOT NULL
);
INSERT INTO parameter_templates(id,name,provider,params_json) VALUES
('10000000-0000-4000-8000-000000000001','OpenAI 标准','openai-compatible','{"size":"1024x1024","quality":"auto","n":1,"background":"auto","outputFormat":"png","outputCompression":100,"moderation":"auto"}'),
('10000000-0000-4000-8000-000000000002','OpenAI 横向高清','openai-compatible','{"size":"1536x1024","quality":"high","n":1,"background":"auto","outputFormat":"png","outputCompression":100,"moderation":"auto"}'),
('10000000-0000-4000-8000-000000000003','Gemini 基础','gemini-compatible','{"imageSize":"auto","aspectRatio":"1:1","imageOnly":false,"thinkingLevel":"auto"}'),
('10000000-0000-4000-8000-000000000004','Gemini 2K','gemini-compatible','{"imageSize":"2K","aspectRatio":"16:9","imageOnly":true,"thinkingLevel":"auto"}');
CREATE TABLE generation_preferences (
    user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
    channel_id VARCHAR(36) NOT NULL REFERENCES channels(id),
    model VARCHAR(512) NOT NULL,
    params_json TEXT NOT NULL,
    PRIMARY KEY (user_id,channel_id,model)
);
CREATE TABLE site_settings (
    id INTEGER PRIMARY KEY,
    default_daily_limit INTEGER,
    global_concurrency INTEGER NOT NULL,
    per_user_concurrency INTEGER NOT NULL,
    queue_limit INTEGER NOT NULL,
    CHECK(default_daily_limit IS NULL OR default_daily_limit>=-1),
    CHECK(global_concurrency BETWEEN 1 AND 32),
    CHECK(per_user_concurrency BETWEEN 1 AND 32),
    CHECK(queue_limit BETWEEN 1 AND 10000)
);
INSERT INTO site_settings VALUES(1,NULL,2,1,100);
CREATE TABLE daily_usage (
    user_id VARCHAR(36) NOT NULL,
    usage_day VARCHAR(10) NOT NULL,
    task_count INTEGER NOT NULL CHECK(task_count>=0),
    PRIMARY KEY(user_id,usage_day)
);
CREATE TABLE task_usage (
    task_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    channel_id VARCHAR(36) NOT NULL,
    shared BOOLEAN NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL
);
CREATE INDEX task_usage_user ON task_usage(user_id,created_at);
CREATE INDEX task_usage_channel ON task_usage(channel_id,created_at);
ALTER TABLE tasks ADD COLUMN channel_id VARCHAR(36);
ALTER TABLE tasks ADD COLUMN quota_day VARCHAR(10);
ALTER TABLE tasks ADD COLUMN quota_reserved BOOLEAN NOT NULL DEFAULT FALSE;
