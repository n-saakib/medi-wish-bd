package bd.mediwish.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** One staged replacement for a User's current mobile number. */
@Entity
@Table(name = "user_mobile_changes")
public class MobileChange {
    @Id
    private UUID id;
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;
    @Column(name = "new_mobile", nullable = false, length = 11)
    private String newMobile;
    @Column(name = "requested_at", nullable = false, updatable = false)
    private Instant requestedAt;

    protected MobileChange() {}

    public MobileChange(UUID userId, String newMobile, Instant requestedAt) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.newMobile = newMobile;
        this.requestedAt = requestedAt;
    }

    public UUID id() { return id; }
    public UUID userId() { return userId; }
    public String newMobile() { return newMobile; }
    public Instant requestedAt() { return requestedAt; }
}
