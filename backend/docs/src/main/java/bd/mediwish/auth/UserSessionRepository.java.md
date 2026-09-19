# UserSessionRepository

Spring Data boundary for session families. It exposes explicit pessimistic locks for one family and all active families of a User, keeping revocation and current-session validation inside `SessionService`.
