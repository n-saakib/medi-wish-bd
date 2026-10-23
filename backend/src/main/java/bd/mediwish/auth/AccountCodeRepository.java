package bd.mediwish.auth;

import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
import java.util.UUID;

public interface AccountCodeRepository extends JpaRepository<AccountCode, UUID> {
    Optional<AccountCode> findByUserIdAndPurpose(UUID userId, AccountCodePurpose purpose);

    @Modifying(flushAutomatically=true, clearAutomatically=true)
    @Query("delete from AccountCode code where code.userId = :userId and code.purpose = :purpose")
    int deleteByUserIdAndPurpose(@Param("userId") UUID userId, @Param("purpose") AccountCodePurpose purpose);

    @Modifying(flushAutomatically=true, clearAutomatically=true)
    @Query("delete from AccountCode code where code.userId = :userId")
    int deleteByUserId(@Param("userId") UUID userId);
}
