package bd.mediwish.catalog;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "product_images")
public class ProductImage {
    @Id private UUID id;
    @Column(name="product_id", nullable=false) private UUID productId;
    @Column(name="object_key", nullable=false, length=120) private String objectKey;
    @Column(name="content_type", nullable=false, length=16) private String contentType;
    @Column(name="byte_size", nullable=false) private int byteSize;
    @Column(nullable=false) private int width;
    @Column(nullable=false) private int height;
    @org.hibernate.annotations.JdbcTypeCode(java.sql.Types.CHAR)
    @Column(nullable=false, columnDefinition="char(64)") private String sha256;
    @Column(name="alt_text", length=160) private String altText;
    @Column(name="display_order", nullable=false) private int displayOrder;
    @Column(nullable=false) private long version;
    @Column(name="created_at", nullable=false) private Instant createdAt;
    @Column(name="updated_at", nullable=false) private Instant updatedAt;
    @Column(name="created_by") private UUID createdBy;
    @Column(name="updated_by") private UUID updatedBy;
    protected ProductImage() {}
    UUID id() { return id; }
    UUID productId() { return productId; }
    String objectKey() { return objectKey; }
    String contentType() { return contentType; }
    int byteSize() { return byteSize; }
    int width() { return width; }
    int height() { return height; }
    String sha256() { return sha256; }
    String altText() { return altText; }
    int displayOrder() { return displayOrder; }
    long version() { return version; }
    Instant createdAt() { return createdAt; }
    void updateAlt(String alt, UUID actor, Instant now) { altText=alt; changed(actor, now); }
    void reorder(int position, UUID actor, Instant now) { displayOrder=position; changed(actor, now); }
    private void changed(UUID actor, Instant now) { version++; updatedBy=actor; updatedAt=now; }
}
