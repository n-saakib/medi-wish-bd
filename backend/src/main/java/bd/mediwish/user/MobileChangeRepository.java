package bd.mediwish.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface MobileChangeRepository extends JpaRepository<MobileChange, UUID> {
    Optional<MobileChange> findByUserId(UUID userId);

    /** Execute before inserting a replacement; a queued JPA delete would run after that insert. */
    @Modifying(flushAutomatically = true)
    @Query("delete from MobileChange change where change.userId = :userId")
    int deleteByUserId(@Param("userId") UUID userId);
}
