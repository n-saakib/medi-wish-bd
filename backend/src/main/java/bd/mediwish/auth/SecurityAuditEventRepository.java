package bd.mediwish.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface SecurityAuditEventRepository extends JpaRepository<SecurityAuditEvent, UUID> {}
