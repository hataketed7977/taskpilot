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

CREATE SCHEMA workspace;

CREATE TABLE workspace.workspaces (
    id UUID,
    type VARCHAR(32) NOT NULL,
    personal_owner_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_workspaces PRIMARY KEY (id),
    CONSTRAINT fk_workspaces__personal_owner_users FOREIGN KEY (personal_owner_user_id)
        REFERENCES access.users(id) ON DELETE RESTRICT,
    CONSTRAINT ck_workspaces__type_supported CHECK (type IN ('PERSONAL', 'TEAM')),
    CONSTRAINT ck_workspaces__personal_owner_consistent CHECK (
        (type = 'PERSONAL' AND personal_owner_user_id IS NOT NULL)
        OR (type = 'TEAM' AND personal_owner_user_id IS NULL)
    )
);

CREATE UNIQUE INDEX ux_workspaces__personal_owner
    ON workspace.workspaces (personal_owner_user_id)
    WHERE type = 'PERSONAL';

CREATE TABLE workspace.workspace_memberships (
    id UUID,
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_workspace_memberships PRIMARY KEY (id),
    CONSTRAINT fk_workspace_memberships__workspaces FOREIGN KEY (workspace_id)
        REFERENCES workspace.workspaces(id) ON DELETE RESTRICT,
    CONSTRAINT fk_workspace_memberships__users FOREIGN KEY (user_id)
        REFERENCES access.users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_workspace_memberships__workspace_user UNIQUE (workspace_id, user_id),
    CONSTRAINT ck_workspace_memberships__role_supported CHECK (role = 'OWNER')
);

CREATE INDEX ix_workspace_memberships__user_workspace
    ON workspace.workspace_memberships (user_id, workspace_id);

CREATE SCHEMA project;

CREATE TABLE project.projects (
    id UUID,
    workspace_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    description VARCHAR(2000) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL,
    version BIGINT NOT NULL,
    created_by_user_id UUID NOT NULL,
    create_request_id UUID NOT NULL,
    create_request_fingerprint VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ,
    CONSTRAINT pk_projects PRIMARY KEY (id),
    CONSTRAINT fk_projects__workspaces FOREIGN KEY (workspace_id)
        REFERENCES workspace.workspaces(id) ON DELETE RESTRICT,
    CONSTRAINT fk_projects__created_by_users FOREIGN KEY (created_by_user_id)
        REFERENCES access.users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_projects__workspace_actor_request
        UNIQUE (workspace_id, created_by_user_id, create_request_id),
    CONSTRAINT ck_projects__name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT ck_projects__description_length CHECK (char_length(description) <= 2000),
    CONSTRAINT ck_projects__status_supported CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_projects__version_non_negative CHECK (version >= 0),
    CONSTRAINT ck_projects__request_fingerprint_not_blank CHECK (btrim(create_request_fingerprint) <> ''),
    CONSTRAINT ck_projects__archive_state_consistent CHECK (
        (status = 'ACTIVE' AND archived_at IS NULL)
        OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)
    )
);

CREATE INDEX ix_projects__workspace_status_created_id
    ON project.projects (workspace_id, status, created_at, id);

CREATE TABLE project.project_memberships (
    id UUID,
    project_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_project_memberships PRIMARY KEY (id),
    CONSTRAINT fk_project_memberships__projects FOREIGN KEY (project_id)
        REFERENCES project.projects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_project_memberships__users FOREIGN KEY (user_id)
        REFERENCES access.users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_project_memberships__project_user UNIQUE (project_id, user_id),
    CONSTRAINT ck_project_memberships__role_supported CHECK (role = 'OWNER')
);

CREATE INDEX ix_project_memberships__user_project
    ON project.project_memberships (user_id, project_id);

CREATE TABLE project.boards (
    id UUID,
    project_id UUID NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(2000) NOT NULL DEFAULT '',
    version BIGINT NOT NULL,
    created_by_user_id UUID NOT NULL,
    create_request_id UUID NOT NULL,
    create_request_fingerprint VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_boards PRIMARY KEY (id),
    CONSTRAINT uq_boards__project_id_id UNIQUE (project_id, id),
    CONSTRAINT fk_boards__projects FOREIGN KEY (project_id)
        REFERENCES project.projects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_boards__created_by_users FOREIGN KEY (created_by_user_id)
        REFERENCES access.users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_boards__project_actor_request
        UNIQUE (project_id, created_by_user_id, create_request_id),
    CONSTRAINT ck_boards__name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT ck_boards__description_length CHECK (char_length(description) <= 2000),
    CONSTRAINT ck_boards__version_non_negative CHECK (version >= 0),
    CONSTRAINT ck_boards__request_fingerprint_not_blank CHECK (btrim(create_request_fingerprint) <> '')
);

CREATE INDEX ix_boards__project_created_id
    ON project.boards (project_id, created_at, id);

CREATE TABLE project.board_columns (
    id UUID,
    project_id UUID NOT NULL,
    board_id UUID NOT NULL,
    name VARCHAR(80) NOT NULL,
    position BIGINT NOT NULL,
    version BIGINT NOT NULL,
    created_by_user_id UUID NOT NULL,
    create_request_id UUID NOT NULL,
    create_request_fingerprint VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_board_columns PRIMARY KEY (id),
    CONSTRAINT uq_board_columns__project_board_id UNIQUE (project_id, board_id, id),
    CONSTRAINT fk_board_columns__boards FOREIGN KEY (project_id, board_id)
        REFERENCES project.boards(project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_board_columns__created_by_users FOREIGN KEY (created_by_user_id)
        REFERENCES access.users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_board_columns__project_actor_request
        UNIQUE (project_id, created_by_user_id, create_request_id),
    CONSTRAINT uq_board_columns__board_position UNIQUE (board_id, position)
        DEFERRABLE INITIALLY IMMEDIATE,
    CONSTRAINT ck_board_columns__name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT ck_board_columns__position_non_negative CHECK (position >= 0),
    CONSTRAINT ck_board_columns__version_non_negative CHECK (version >= 0),
    CONSTRAINT ck_board_columns__request_fingerprint_not_blank CHECK (btrim(create_request_fingerprint) <> '')
);

CREATE INDEX ix_board_columns__board_position_id
    ON project.board_columns (board_id, position, id);

CREATE TABLE project.work_items (
    id UUID,
    project_id UUID NOT NULL,
    title VARCHAR(300) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    version BIGINT NOT NULL,
    created_by_user_id UUID NOT NULL,
    create_request_id UUID NOT NULL,
    create_request_fingerprint VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_work_items PRIMARY KEY (id),
    CONSTRAINT uq_work_items__project_id_id UNIQUE (project_id, id),
    CONSTRAINT fk_work_items__projects FOREIGN KEY (project_id)
        REFERENCES project.projects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_work_items__created_by_users FOREIGN KEY (created_by_user_id)
        REFERENCES access.users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_work_items__project_actor_request
        UNIQUE (project_id, created_by_user_id, create_request_id),
    CONSTRAINT ck_work_items__title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT ck_work_items__description_length CHECK (char_length(description) <= 10000),
    CONSTRAINT ck_work_items__version_non_negative CHECK (version >= 0),
    CONSTRAINT ck_work_items__request_fingerprint_not_blank CHECK (btrim(create_request_fingerprint) <> '')
);

CREATE INDEX ix_work_items__project_created_id
    ON project.work_items (project_id, created_at, id);

CREATE TABLE project.board_placements (
    id UUID,
    project_id UUID NOT NULL,
    board_id UUID NOT NULL,
    column_id UUID NOT NULL,
    work_item_id UUID NOT NULL,
    position BIGINT NOT NULL,
    version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_board_placements PRIMARY KEY (id),
    CONSTRAINT fk_board_placements__boards FOREIGN KEY (project_id, board_id)
        REFERENCES project.boards(project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_board_placements__columns FOREIGN KEY (project_id, board_id, column_id)
        REFERENCES project.board_columns(project_id, board_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_board_placements__work_items FOREIGN KEY (project_id, work_item_id)
        REFERENCES project.work_items(project_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_board_placements__board_work_item UNIQUE (board_id, work_item_id),
    CONSTRAINT uq_board_placements__column_position UNIQUE (board_id, column_id, position)
        DEFERRABLE INITIALLY IMMEDIATE,
    CONSTRAINT ck_board_placements__position_non_negative CHECK (position >= 0),
    CONSTRAINT ck_board_placements__version_non_negative CHECK (version >= 0)
);

CREATE INDEX ix_board_placements__column_position_id
    ON project.board_placements (board_id, column_id, position, id);
