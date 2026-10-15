package bd.mediwish.address;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface SavedAddressRepository extends JpaRepository<SavedAddress, SavedAddress.Key> {
    List<SavedAddress> findByUserIdOrderByCreatedAtAscIdAsc(UUID userId);
    @Modifying
    @Query(value = """
            INSERT INTO saved_addresses (user_id, id, label, recipient_name, mobile, address_line, city,
                is_default, version, created_at, updated_at)
            VALUES (:userId, :id, :label, :recipientName, :mobile, :addressLine, :city, :isDefault, 0, :now, :now)
            ON CONFLICT (user_id, id) DO NOTHING
            """, nativeQuery = true)
    int insertIfAbsent(UUID id, UUID userId, String label, String recipientName, String mobile,
                       String addressLine, String city, boolean isDefault, Instant now);
    @Modifying
    @Query(value = "INSERT INTO saved_address_changes (id, user_id, changed_at) VALUES (:id, :userId, :changedAt)", nativeQuery = true)
    int recordChange(UUID id, UUID userId, Instant changedAt);
    @Modifying
    @Query(value = "DELETE FROM saved_address_changes WHERE user_id = :userId AND changed_at < :before", nativeQuery = true)
    int deleteChangesBefore(UUID userId, Instant before);
    @Query(value = "SELECT count(*) FROM saved_address_changes WHERE user_id = :userId AND changed_at >= :from AND changed_at < :until", nativeQuery = true)
    long countChanges(UUID userId, Instant from, Instant until);
}
