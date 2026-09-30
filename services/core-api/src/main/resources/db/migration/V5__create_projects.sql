CREATE TABLE projects (
    project_id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    name VARCHAR(320) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (project_id, workspace_id)
);

CREATE INDEX projects_workspace_project_idx ON projects(workspace_id, project_id);

CREATE TABLE project_memberships (
    project_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES projects(project_id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX project_memberships_user_workspace_project_idx
    ON project_memberships(user_id, workspace_id, project_id);
