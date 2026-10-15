package bd.mediwish.catalog;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "discount_changes")
public class DiscountChange {

    @Id
    private UUID id;

    @Column(name = "discount_id", nullable = false)
    private UUID discountId;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    @Column(name = "actor_user_id")
    private UUID actorUserId;

    @Enumerated(EnumType.STRING)
    @Column(name = "change_type", nullable = false, length = 16)
    private DiscountChangeType changeType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private DiscountKind kind;

    @Column(precision = 4, scale = 2)
    private BigDecimal percent;

    @Column(precision = 9, scale = 2)
    private BigDecimal amount;

    @Column(name = "starts_on", nullable = false)
    private LocalDate startsOn;

    @Column(name = "ends_on")
    private LocalDate endsOn;

    @Column(name = "request_id", length = 64)
    private String requestId;

    protected DiscountChange() {
    }

    DiscountChange(Discount discount, Instant now, UUID actor, DiscountChangeType type, String requestId) {
        this.id = UUID.randomUUID();
        this.discountId = discount.id();
        this.occurredAt = now;
        this.actorUserId = actor;
        this.changeType = type;
        this.kind = discount.kind();
        this.percent = kind == DiscountKind.PERCENTAGE ? discount.value() : null;
        this.amount = kind == DiscountKind.FLAT ? discount.value() : null;
        this.startsOn = discount.startsOn();
        this.endsOn = discount.endsOn();
        this.requestId = requestId;
    }

    Instant occurredAt() {
        return occurredAt;
    }

    DiscountChangeType changeType() {
        return changeType;
    }

}
