package bd.mediwish.address;

import jakarta.persistence.*;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "saved_addresses")
@IdClass(SavedAddress.Key.class)
public class SavedAddress {
    @Id @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;
    @Id @Column(nullable = false, updatable = false)
    private UUID id;
    @Column(length = 40) private String label;
    @Column(name = "recipient_name", nullable = false, length = 100) private String recipientName;
    @Column(nullable = false, length = 11) private String mobile;
    @Column(name = "address_line", nullable = false, length = 200) private String addressLine;
    @Column(nullable = false, length = 60) private String city;
    @Column(name = "is_default", nullable = false) private boolean isDefault;
    @Column(nullable = false) private long version;
    @Column(name = "created_at", nullable = false, updatable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    protected SavedAddress() {}
    public SavedAddress(UUID userId, UUID id, AddressFields fields, boolean isDefault, Instant now) {
        this.userId = userId; this.id = id; this.isDefault = isDefault; this.createdAt = now; edit(fields, now);
    }
    public void edit(AddressFields fields, Instant now) {
        label = fields.label(); recipientName = fields.recipientName(); mobile = fields.mobile();
        addressLine = fields.addressLine(); city = fields.city(); updatedAt = now;
    }
    public void makeDefault() { isDefault = true; }
    public void clearDefault() { isDefault = false; }
    public void bumpVersion() { version++; }
    public UUID userId() { return userId; }
    public UUID id() { return id; }
    public String label() { return label; }
    public String recipientName() { return recipientName; }
    public String mobile() { return mobile; }
    public String addressLine() { return addressLine; }
    public String city() { return city; }
    public boolean isDefault() { return isDefault; }
    public long version() { return version; }
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
    public AddressFields fields() { return new AddressFields(label, recipientName, mobile, addressLine, city); }

    public static class Key implements Serializable {
        public UUID userId;
        public UUID id;
        public Key() {}
        public Key(UUID userId, UUID id) { this.userId = userId; this.id = id; }
        @Override public boolean equals(Object other) {
            return other instanceof Key key && Objects.equals(userId, key.userId) && Objects.equals(id, key.id);
        }
        @Override public int hashCode() { return Objects.hash(userId, id); }
    }
}
