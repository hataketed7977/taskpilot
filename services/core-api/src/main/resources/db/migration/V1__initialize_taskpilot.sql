CREATE SCHEMA access;

CREATE TABLE access.users (
    id UUID,
    display_name VARCHAR(200) NOT NULL,
    avatar_url VARCHAR(2048),
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT ck_users__display_name_not_blank CHECK (btrim(display_name) <> ''),
    CONSTRAINT ck_users__status_supported CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE TABLE access.external_identities (
    id UUID,
    user_id UUID NOT NULL,
    provider VARCHAR(64) NOT NULL,
    authority VARCHAR(512) NOT NULL,
    subject VARCHAR(512) NOT NULL,
    linked_at TIMESTAMPTZ NOT NULL,
    last_authenticated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_external_identities PRIMARY KEY (id),
    CONSTRAINT fk_external_identities__users FOREIGN KEY (user_id)
        REFERENCES access.users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_external_identities__provider_authority_subject UNIQUE (provider, authority, subject),
    CONSTRAINT ck_external_identities__provider_not_blank CHECK (btrim(provider) <> ''),
    CONSTRAINT ck_external_identities__authority_not_blank CHECK (btrim(authority) <> ''),
    CONSTRAINT ck_external_identities__subject_not_blank CHECK (btrim(subject) <> '')
);

CREATE INDEX ix_external_identities__user_id ON access.external_identities (user_id);

CREATE TABLE access.terms_acceptances (
    id UUID,
    user_id UUID NOT NULL,
    legal_bundle_version VARCHAR(128) NOT NULL,
    terms_version VARCHAR(128) NOT NULL,
    privacy_version VARCHAR(128) NOT NULL,
    locale VARCHAR(35) NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_terms_acceptances PRIMARY KEY (id),
    CONSTRAINT fk_terms_acceptances__users FOREIGN KEY (user_id)
        REFERENCES access.users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_terms_acceptances__user_bundle UNIQUE (user_id, legal_bundle_version),
    CONSTRAINT ck_terms_acceptances__bundle_not_blank CHECK (btrim(legal_bundle_version) <> ''),
    CONSTRAINT ck_terms_acceptances__terms_not_blank CHECK (btrim(terms_version) <> ''),
    CONSTRAINT ck_terms_acceptances__privacy_not_blank CHECK (btrim(privacy_version) <> ''),
    CONSTRAINT ck_terms_acceptances__locale_not_blank CHECK (btrim(locale) <> '')
);

CREATE INDEX ix_terms_acceptances__user_id ON access.terms_acceptances (user_id);
