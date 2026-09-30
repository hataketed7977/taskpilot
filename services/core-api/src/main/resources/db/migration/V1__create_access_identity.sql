CREATE TABLE app_users (
    user_id UUID PRIMARY KEY,
    display_name VARCHAR(200) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT app_users_display_name_not_blank CHECK (btrim(display_name) <> ''),
    CONSTRAINT app_users_status_supported CHECK (status IN ('ACTIVE'))
);

CREATE TABLE email_identities (
    email_identity_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
    normalized_email VARCHAR(254) NOT NULL,
    display_email VARCHAR(254) NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT email_identities_one_primary_email_per_user UNIQUE (user_id),
    CONSTRAINT email_identities_normalized_email_unique UNIQUE (normalized_email),
    CONSTRAINT email_identities_normalized_email_not_blank CHECK (btrim(normalized_email) <> ''),
    CONSTRAINT email_identities_display_email_not_blank CHECK (btrim(display_email) <> '')
);

CREATE TABLE password_credentials (
    user_id UUID PRIMARY KEY REFERENCES app_users(user_id) ON DELETE RESTRICT,
    argon2id_digest TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT password_credentials_argon2id_digest CHECK (argon2id_digest LIKE '$argon2id$%')
);

CREATE TABLE terms_acceptances (
    user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
    terms_version VARCHAR(100) NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, terms_version),
    CONSTRAINT terms_acceptances_version_not_blank CHECK (btrim(terms_version) <> '')
);
