package bd.mediwish.catalog;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "discounts")
public class Discount {

    @Id
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", nullable = false, length = 16)
    private DiscountTargetType targetType;

    @Column(name = "product_id")
    private UUID productId;

    @Column(name = "category_id")
    private UUID categoryId;

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

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "updated_by")
    private UUID updatedBy;

    protected Discount() {
    }

    Discount(UUID id, DiscountTargetType targetType, UUID targetId, DiscountKind kind, BigDecimal value,
            LocalDate startsOn, LocalDate endsOn, UUID actor, Instant now) {
        this.id = id;
        this.targetType = targetType;
        this.productId = targetType == DiscountTargetType.PRODUCT ? targetId : null;
        this.categoryId = targetType == DiscountTargetType.CATEGORY ? targetId : null;
        assign(kind, value, startsOn, endsOn);
        this.createdBy = actor;
        this.updatedBy = actor;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public DiscountTargetType targetType() {
        return targetType;
    }

    public UUID targetId() {
        return productId == null ? categoryId : productId;
    }

    public UUID productId() {
        return productId;
    }

    public UUID categoryId() {
        return categoryId;
    }

    public DiscountKind kind() {
        return kind;
    }

    public BigDecimal value() {
        return kind == DiscountKind.PERCENTAGE ? percent : amount;
    }

    public LocalDate startsOn() {
        return startsOn;
    }

    public LocalDate endsOn() {
        return endsOn;
    }

    public Instant endedAt() {
        return endedAt;
    }

    public long version() {
        return version;
    }

    public Instant updatedAt() {
        return updatedAt;
    }

    public UUID updatedBy() {
        return updatedBy;
    }

    public DiscountStatus status(LocalDate today) {
        if (endedAt != null || endsOn != null && endsOn.isBefore(today))
            return DiscountStatus.ENDED;
        return startsOn.isAfter(today) ? DiscountStatus.SCHEDULED : DiscountStatus.ACTIVE;
    }

    void update(DiscountKind kind, BigDecimal value, LocalDate startsOn, LocalDate endsOn, UUID actor, Instant now) {
        assign(kind, value, startsOn, endsOn);
        touch(actor, now);
    }

    void end(UUID actor, Instant now) {
        endedAt = now;
        touch(actor, now);
    }

    private void assign(DiscountKind kind, BigDecimal value, LocalDate startsOn, LocalDate endsOn) {
        this.kind = kind;
        this.percent = kind == DiscountKind.PERCENTAGE ? value : null;
        this.amount = kind == DiscountKind.FLAT ? value : null;
        this.startsOn = startsOn;
        this.endsOn = endsOn;
    }

    private void touch(UUID actor, Instant now) {
        version++;
        updatedBy = actor;
        updatedAt = now;
    }

}
