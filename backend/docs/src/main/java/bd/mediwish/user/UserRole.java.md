# UserRole

Enumerates the roles assignable to the shared User resource: `CUSTOMER`, `ADMIN`, `MODERATOR` and `DELIVERY_PERSON`. Public registration assigns only `CUSTOMER`; Spring Security reads the persisted assignments for current authorization decisions. Role-specific behavior belongs in the relevant feature service rather than in separate identity entities.
