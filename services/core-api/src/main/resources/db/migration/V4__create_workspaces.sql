CREATE TABLE workspaces (
    workspace_id UUID PRIMARY KEY,
    name VARCHAR(320) NOT NULL,
    workspace_type VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT workspaces_type_check CHECK (workspace_type IN ('ORGANIZATION', 'PERSONAL'))
);

CREATE TABLE workspace_memberships (
    workspace_id UUID NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_memberships_user_workspace_idx
    ON workspace_memberships(user_id, workspace_id);

CREATE TABLE workspace_creation_requests (
    actor_user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    operation VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (actor_user_id, operation, idempotency_key),
    CONSTRAINT workspace_creation_requests_operation_check
        CHECK (operation = 'CREATE_ORGANIZATION_WORKSPACE')
);
