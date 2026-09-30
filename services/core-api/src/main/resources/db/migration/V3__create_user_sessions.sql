ALTER TABLE password_credentials
    ADD COLUMN password_version BIGINT NOT NULL DEFAULT 1,
    ADD CONSTRAINT password_credentials_version_positive CHECK (password_version > 0);

CREATE TABLE user_sessions (
    session_id UUID PRIMARY KEY,
    family_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
    access_token_digest VARCHAR(100) NOT NULL UNIQUE,
    access_expires_at TIMESTAMPTZ NOT NULL,
    refresh_token_digest VARCHAR(100) NOT NULL UNIQUE,
    refresh_expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL,
    generation BIGINT NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL,
    last_refreshed_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    CONSTRAINT user_sessions_time_order CHECK (
        access_expires_at > created_at
        AND refresh_expires_at > created_at
        AND absolute_expires_at >= refresh_expires_at
    ),
    CONSTRAINT user_sessions_generation_positive CHECK (generation > 0),
    CONSTRAINT user_sessions_status_supported CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT user_sessions_revocation_consistent CHECK (
        (status = 'ACTIVE' AND revoked_at IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
    )
);

CREATE INDEX user_sessions_user_active ON user_sessions (user_id, status);
CREATE INDEX user_sessions_family ON user_sessions (family_id);

CREATE TABLE refresh_recoveries (
    refresh_request_id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES user_sessions(session_id) ON DELETE CASCADE,
    previous_refresh_digest VARCHAR(100) NOT NULL,
    encrypted_result BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT refresh_recoveries_time_order CHECK (expires_at > created_at),
    CONSTRAINT refresh_recoveries_previous_digest_not_blank CHECK (btrim(previous_refresh_digest) <> '')
);

CREATE UNIQUE INDEX refresh_recoveries_previous_request
    ON refresh_recoveries (previous_refresh_digest, refresh_request_id);
CREATE INDEX refresh_recoveries_previous_digest ON refresh_recoveries (previous_refresh_digest);
