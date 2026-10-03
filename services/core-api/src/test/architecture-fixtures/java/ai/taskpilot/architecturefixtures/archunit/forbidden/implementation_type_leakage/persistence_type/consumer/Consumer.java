package ai.taskpilot.architecturefixtures.archunit.forbidden.implementation_type_leakage.persistence_type.consumer;

import ai.taskpilot.architecturefixtures.archunit.forbidden.implementation_type_leakage.persistence_type.infrastructure.persistence.PersistenceType;

public final class Consumer {
    private PersistenceType dependency;
}
