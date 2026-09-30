CREATE TABLE verification_challenges (
    challenge_id UUID PRIMARY KEY,
    purpose VARCHAR(32) NOT NULL,
    normalized_email VARCHAR(254) NOT NULL,
    user_id UUID NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
    code_digest VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    resend_available_at TIMESTAMPTZ NOT NULL,
    maximum_attempts SMALLINT NOT NULL,
    failed_attempts SMALLINT NOT NULL DEFAULT 0,
    delivery_state VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    delivery_recorded_at TIMESTAMPTZ NULL,
    consumed_at TIMESTAMPTZ NULL,
    superseded_at TIMESTAMPTZ NULL,
    CONSTRAINT verification_challenges_purpose_supported CHECK (
        purpose IN ('REGISTER_EMAIL_VERIFY', 'LOGIN_EMAIL_OTP', 'PASSWORD_RESET')
    ),
    CONSTRAINT verification_challenges_email_not_blank CHECK (btrim(normalized_email) <> ''),
    CONSTRAINT verification_challenges_digest_not_blank CHECK (btrim(code_digest) <> ''),
    CONSTRAINT verification_challenges_time_order CHECK (
        expires_at > created_at AND resend_available_at > created_at
    ),
    CONSTRAINT verification_challenges_attempts_valid CHECK (
        maximum_attempts > 0 AND failed_attempts >= 0 AND failed_attempts <= maximum_attempts
    ),
    CONSTRAINT verification_challenges_delivery_state_supported CHECK (
        delivery_state IN ('PENDING', 'SENT', 'OUTCOME_UNKNOWN', 'SUPPRESSED', 'FAILED')
    )
);

CREATE INDEX verification_challenges_subject_lookup
    ON verification_challenges (purpose, normalized_email, created_at DESC);

CREATE TABLE auth_continuations (
    continuation_id UUID PRIMARY KEY,
    purpose VARCHAR(32) NOT NULL,
    normalized_email VARCHAR(254) NOT NULL,
    user_id UUID NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
    challenge_id UUID NOT NULL UNIQUE REFERENCES verification_challenges(challenge_id) ON DELETE RESTRICT,
    secret_digest VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    CONSTRAINT auth_continuations_purpose_supported CHECK (
        purpose IN ('REGISTER_EMAIL_VERIFY', 'PASSWORD_RESET')
    ),
    CONSTRAINT auth_continuations_email_not_blank CHECK (btrim(normalized_email) <> ''),
    CONSTRAINT auth_continuations_digest_not_blank CHECK (btrim(secret_digest) <> ''),
    CONSTRAINT auth_continuations_time_order CHECK (expires_at > created_at)
);

CREATE TABLE verification_rate_limits (
    action VARCHAR(32) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    dimension VARCHAR(32) NOT NULL,
    protected_key VARCHAR(100) NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL,
    PRIMARY KEY (action, purpose, dimension, protected_key),
    CONSTRAINT verification_rate_limits_action_supported CHECK (
        action IN ('REQUEST_CODE', 'VERIFY_CODE')
    ),
    CONSTRAINT verification_rate_limits_purpose_supported CHECK (
        purpose IN ('REGISTER_EMAIL_VERIFY', 'LOGIN_EMAIL_OTP', 'PASSWORD_RESET')
    ),
    CONSTRAINT verification_rate_limits_dimension_supported CHECK (
        dimension IN ('EMAIL', 'SOURCE_NETWORK', 'DEVICE_INSTALLATION')
    ),
    CONSTRAINT verification_rate_limits_key_not_blank CHECK (btrim(protected_key) <> ''),
    CONSTRAINT verification_rate_limits_time_order CHECK (expires_at > window_started_at),
    CONSTRAINT verification_rate_limits_attempt_count_positive CHECK (attempt_count > 0)
);

CREATE INDEX verification_rate_limits_expiry ON verification_rate_limits (expires_at);
