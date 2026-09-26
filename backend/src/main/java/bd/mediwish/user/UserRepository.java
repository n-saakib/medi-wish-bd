package bd.mediwish.user;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {
    boolean existsByUsername(String username);
    boolean existsByMobile(String mobile);
    Optional<User> findByUsername(String username);
    Optional<User> findByMobileAndMobileVerifiedTrue(String mobile);
    List<User> findTop2ByEmailIgnoreCase(String email);
}
