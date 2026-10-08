package bd.mediwish.catalog;

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
@Table(name = "products")
public class Product {
    @Id private UUID id;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private ProductKind kind;
    @Column(nullable = false, length = 160) private String name;
    @Column(name = "brand_name", length = 120) private String brandName;
    @Column(name = "generic_name", length = 200) private String genericName;
    @Column(length = 120) private String manufacturer;
    @Column(name = "dosage_form", length = 120) private String dosageForm;
    @Column(name = "sale_unit", nullable = false, length = 80) private String saleUnit;
    @Column(length = 4000) private String description;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "category_id", nullable = false) private Category category;
    @Column(name = "selling_price", precision = 9, scale = 2) private BigDecimal sellingPrice;
    @Column(precision = 9, scale = 2) private BigDecimal mrp;
    @Column(nullable = false) private boolean active;
    @Column(name = "require_validation", nullable = false) private boolean requireValidation;
    @Column(nullable = false) private long version;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Column(name = "created_by") private UUID createdBy;
    @Column(name = "updated_by") private UUID updatedBy;

    protected Product() {}

    public UUID id() { return id; }
    public ProductKind kind() { return kind; }
    public Category category() { return category; }
    public Money sellingPrice() { return sellingPrice == null ? null : Money.parse(sellingPrice.toPlainString()); }
    public Money mrp() { return mrp == null ? null : Money.parse(mrp.toPlainString()); }
    public boolean active() { return active; }
    public boolean requireValidation() { return requireValidation; }
    public long version() { return version; }
    public Instant updatedAt() { return updatedAt; }
    public UUID updatedBy() { return updatedBy; }
    public ProductStatus status() {
        return active ? ProductStatus.ACTIVE : sellingPrice == null ? ProductStatus.NEEDS_PRICE : ProductStatus.INACTIVE;
    }

    public ProductRules.CatalogFields fields() {
        return new ProductRules.CatalogFields(name, brandName, genericName, manufacturer, dosageForm, saleUnit,
                description, category.id(), requireValidation, active);
    }

    void updateCatalog(ProductRules.CatalogFields fields, Category category, UUID actor, Instant now) {
        this.name = fields.name();
        this.brandName = fields.brandName();
        this.genericName = fields.genericName();
        this.manufacturer = fields.manufacturer();
        this.dosageForm = fields.dosageForm();
        this.saleUnit = fields.saleUnit();
        this.description = fields.description();
        this.category = category;
        this.requireValidation = fields.requireValidation();
        this.active = fields.active();
        touch(actor, now);
    }

    void updatePricing(Money sellingPrice, Money mrp, UUID actor, Instant now) {
        this.sellingPrice = sellingPrice.value();
        this.mrp = mrp == null ? null : mrp.value();
        touch(actor, now);
    }

    private void touch(UUID actor, Instant now) {
        this.version++;
        this.updatedBy = actor;
        this.updatedAt = now;
    }
}
