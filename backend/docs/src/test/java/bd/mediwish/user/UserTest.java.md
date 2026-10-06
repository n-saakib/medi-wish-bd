# UserTest

Protects the single-role domain seam: registration assigns Customer and version zero, replacement removes the previous role, repeat assignment is a no-op, administrative version increment is explicit, and demotion removes the staff-MFA requirement. PostgreSQL integrity is verified separately in StaffRoleMigrationIT.
