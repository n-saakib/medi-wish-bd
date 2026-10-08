package bd.mediwish.catalog;

import bd.mediwish.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "product_changes")
public class ProductChange {
    @Id private UUID id;
    @Column(name = "product_id", nullable = false, updatable = false) private UUID productId;
    @Column(name = "occurred_at", nullable = false, updatable = false) private Instant occurredAt;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "actor_user_id") private User actor;
    @Enumerated(EnumType.STRING) @Column(name = "change_type", nullable = false, length = 32)
    private ProductChangeType changeType;
    @Column(name = "old_selling_price", precision = 9, scale = 2) private BigDecimal oldSellingPrice;
    @Column(name = "new_selling_price", precision = 9, scale = 2) private BigDecimal newSellingPrice;
    @Column(name = "old_mrp", precision = 9, scale = 2) private BigDecimal oldMrp;
    @Column(name = "new_mrp", precision = 9, scale = 2) private BigDecimal newMrp;
    @Column(name = "old_require_validation") private Boolean oldRequireValidation;
    @Column(name = "new_require_validation") private Boolean newRequireValidation;
    @Column(name = "request_id", length = 64) private String requestId;

    protected ProductChange() {}

    ProductChange(UUID productId, Instant now, User actor, ProductChangeType type,
                  Money oldPrice, Money newPrice, Money oldMrp, Money newMrp,
                  Boolean oldFlag, Boolean newFlag, String requestId) {
        this.id = UUID.randomUUID();
        this.productId = productId;
        this.occurredAt = now;
        this.actor = actor;
        this.changeType = type;
        this.oldSellingPrice = oldPrice == null ? null : oldPrice.value();
        this.newSellingPrice = newPrice == null ? null : newPrice.value();
        this.oldMrp = oldMrp == null ? null : oldMrp.value();
        this.newMrp = newMrp == null ? null : newMrp.value();
        this.oldRequireValidation = oldFlag;
        this.newRequireValidation = newFlag;
        this.requestId = requestId;
    }

    public Instant occurredAt() { return occurredAt; }
    public String actorUsername() { return actor == null ? null : actor.username(); }
    public ProductChangeType changeType() { return changeType; }
    public String oldSellingPrice() { return decimal(oldSellingPrice); }
    public String newSellingPrice() { return decimal(newSellingPrice); }
    public String oldMrp() { return decimal(oldMrp); }
    public String newMrp() { return decimal(newMrp); }
    public Boolean oldRequireValidation() { return oldRequireValidation; }
    public Boolean newRequireValidation() { return newRequireValidation; }

    private static String decimal(BigDecimal value) { return value == null ? null : value.toPlainString(); }
}
