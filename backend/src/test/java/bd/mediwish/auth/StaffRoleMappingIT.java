package bd.mediwish.auth;

import bd.mediwish.testsupport.TestApplication;
import bd.mediwish.testsupport.TestDatabase;
import bd.mediwish.user.User;
import bd.mediwish.user.UserRole;
import bd.mediwish.user.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.boot.hibernate.autoconfigure.HibernatePropertiesCustomizer;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.ArrayList;
import java.util.List;


import static org.assertj.core.api.Assertions.assertThat;

/** Pins the SQL of the retained role mapping and PostgreSQL user-row lock modes. */
@Tag("integration")
class StaffRoleMappingIT {
    @Test
    void roleReplacementAndUserLocksUseTheExpectedPostgresqlSql() throws Exception {
        try (var database = TestDatabase.create();
             var app = TestApplication.start(database.applicationProperties(), SqlCaptureConfiguration.class)) {
            var entityManager = app.bean(EntityManager.class);
            var transactions = new TransactionTemplate(app.bean(PlatformTransactionManager.class));
            var capture = app.bean(SqlCapture.class);
            var user = new User("mapping_customer", "01700009777", null, "synthetic-verifier");
            transactions.executeWithoutResult(status -> { entityManager.persist(user); entityManager.flush(); });
            capture.sql.clear();
            transactions.executeWithoutResult(status -> {
                var managed = entityManager.find(User.class, user.id());
                managed.replaceRole(UserRole.MODERATOR);
                entityManager.flush();
            });
            assertThat(capture.sql).anyMatch(sql -> sql.matches("delete from (?:[a-z0-9_]+\\.)?user_roles.*"));
            assertThat(capture.sql).anyMatch(sql -> sql.matches("insert into (?:[a-z0-9_]+\\.)?user_roles.*"));
            var users = app.bean(UserRepository.class);
            capture.sql.clear();
            transactions.executeWithoutResult(status -> users.findAllByIdForUpdate(List.of(user.id())));
            assertLockPrecedesRoleRead(capture.sql, "for no key update");
            capture.sql.forEach(sql -> System.out.println("T08 write lock SQL: " + sql));
            capture.sql.clear();
            transactions.executeWithoutResult(status -> users.findByIdForShare(user.id()));
            assertLockPrecedesRoleRead(capture.sql, "for share");
            capture.sql.stream().filter(sql -> sql.contains("user_roles") || sql.contains("for "))
                    .forEach(sql -> System.out.println("T08 mapping SQL: " + sql));
        }
    }

    private static void assertLockPrecedesRoleRead(List<String> statements, String lockClause) {
        int lock = -1, roleRead = -1;
        for (int i = 0; i < statements.size(); i++) {
            if (statements.get(i).contains(lockClause)) lock = i;
            if (statements.get(i).startsWith("select") && statements.get(i).contains("user_roles")) roleRead = i;
        }
        assertThat(lock).as("inline User lock precedes current role hydration").isGreaterThanOrEqualTo(0);
        assertThat(roleRead).isGreaterThan(lock);
    }
    static final class SqlCapture implements StatementInspector {
        final List<String> sql = new ArrayList<>();
        @Override public String inspect(String statement) { sql.add(statement.toLowerCase(java.util.Locale.ROOT)); return statement; }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class SqlCaptureConfiguration {
        @Bean SqlCapture sqlCapture() { return new SqlCapture(); }
        @Bean HibernatePropertiesCustomizer captureStatements(SqlCapture capture) {
            return properties -> properties.put("hibernate.session_factory.statement_inspector", capture);
        }
    }
}
