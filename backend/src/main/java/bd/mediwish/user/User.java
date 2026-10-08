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
import org.hibernate.annotations.BatchSize;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "users")
public class User {
    @Id
    private UUID id;
    @Column(nullable = false, length = 50, updatable = false)
    private String username;
    @Column(nullable = false, length = 30)
    private String mobile;
    @Column(length = 320)
    private String email;
    @Column(name = "full_name", length = 100)
    private String fullName;
    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;
    @Column(name = "profile_version", nullable = false)
    private long profileVersion;
    @Enumerated(EnumType.STRING)
    @Column(name = "account_state", nullable = false, length = 24)
    private AccountState accountState;
    @Column(name = "password_hash", nullable = false)
    private String passwordHash;
    @Column(name = "mobile_verified", nullable = false)
    private boolean mobileVerified;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "roles_version", nullable = false)
    private long rolesVersion;
    @BatchSize(size = 50)
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
        this.profileVersion = 0;
        this.accountState = AccountState.ACTIVE;
        this.passwordHash = passwordHash;
        this.createdAt = Instant.now();
        this.roles.add(UserRole.CUSTOMER);
    }

    public UUID id() { return id; }
    public String username() { return username; }
    public String mobile() { return mobile; }
    public String email() { return email; }
    public String fullName() { return fullName; }
    public LocalDate dateOfBirth() { return dateOfBirth; }
    public long profileVersion() { return profileVersion; }
    public AccountState accountState() { return accountState; }
    public String passwordHash() { return passwordHash; }
    public boolean mobileVerified() { return mobileVerified; }
    public Set<UserRole> roles() { return Collections.unmodifiableSet(roles); }

    public Instant createdAt() { return createdAt; }
    public UserRole role() { return roles.iterator().next(); }
    public long rolesVersion() { return rolesVersion; }
    public void bumpRolesVersion() { rolesVersion++; }
    public boolean hasStaffRole() { return role().isStaff(); }
    public void updateProfile(String fullName, String email, LocalDate dateOfBirth) {
        this.fullName = fullName;
        this.email = email;
        this.dateOfBirth = dateOfBirth;
    }
    public void bumpProfileVersion() { profileVersion += 1; }
    public void activateMobile(String mobile) {
        this.mobile = mobile;
        this.mobileVerified = true;
    }

    /** Replaces the one assignment; a repeated assignment does not dirty the collection. */
    public void replaceRole(UserRole role) {
        java.util.Objects.requireNonNull(role);
        if (role() == role) return;
        roles.clear();
        roles.add(role);
    }
}
