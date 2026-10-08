package bd.mediwish.catalog;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "product_categories")
public class Category {
    @Id private UUID id;
    @Column(nullable = false, length = 80) private String name;
    @Column(nullable = false) private boolean active;
    @Column(nullable = false) private long version;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Column(name = "created_by") private UUID createdBy;
    @Column(name = "updated_by") private UUID updatedBy;

    protected Category() {}

    Category(UUID id, String name, UUID actor, Instant now) {
        this.id = id;
        this.name = name;
        this.active = true;
        this.createdAt = now;
        this.updatedAt = now;
        this.createdBy = actor;
        this.updatedBy = actor;
    }

    public UUID id() { return id; }
    public String name() { return name; }
    public boolean active() { return active; }
    public long version() { return version; }

    void update(String name, boolean active, UUID actor, Instant now) {
        this.name = name;
        this.active = active;
        this.version++;
        this.updatedBy = actor;
        this.updatedAt = now;
    }
}
