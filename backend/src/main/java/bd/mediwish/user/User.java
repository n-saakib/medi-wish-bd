package bd.mediwish.user;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "users")
public class User {
    @Id
    private UUID id;
    @Column(nullable = false, unique = true, length = 50, updatable = false)
    private String username;
    @Column(nullable = false, unique = true, length = 30)
    private String mobile;
    @Column(length = 320)
    private String email;
    @Column(name = "password_hash", nullable = false)
    private String passwordHash;
    @Column(name = "mobile_verified", nullable = false)
    private boolean mobileVerified;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_roles", joinColumns = @JoinColumn(name = "user_id"))
    @Column(name = "role", nullable = false, length = 32)
    @Enumerated(EnumType.STRING)
    private Set<UserRole> roles = new LinkedHashSet<>();

    protected User() {}

    public User(String username, String mobile, String email, String passwordHash) {
        this.id = UUID.randomUUID();
        this.username = username;
        this.mobile = mobile;
        this.email = email;
        this.passwordHash = passwordHash;
        this.createdAt = Instant.now();
        this.roles.add(UserRole.CUSTOMER);
    }

    public UUID id() { return id; }
    public String username() { return username; }
    public String mobile() { return mobile; }
    public String email() { return email; }
    public String passwordHash() { return passwordHash; }
    public boolean mobileVerified() { return mobileVerified; }
    public Set<UserRole> roles() { return Collections.unmodifiableSet(roles); }
}
