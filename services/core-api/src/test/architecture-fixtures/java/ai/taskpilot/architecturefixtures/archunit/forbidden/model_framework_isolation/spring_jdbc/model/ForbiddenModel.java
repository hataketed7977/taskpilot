package ai.taskpilot.architecturefixtures.archunit.forbidden.model_framework_isolation.spring_jdbc.model;

import org.springframework.jdbc.core.JdbcTemplate;

public final class ForbiddenModel {
    private JdbcTemplate dependency;
}
