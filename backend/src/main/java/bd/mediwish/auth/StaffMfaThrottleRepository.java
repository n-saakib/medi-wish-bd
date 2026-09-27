package bd.mediwish.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

/** Read and changed only under the User's row lock, so a User's counter has one writer at a time. */
public interface StaffMfaThrottleRepository extends JpaRepository<StaffMfaThrottle, UUID> {}
