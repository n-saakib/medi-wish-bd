# UserSessionRepository

Spring Data boundary for session families. It exposes explicit pessimistic locks for one family, all active families of a User, and the families that a set of refresh-token digests belong to, keeping revocation and current-session validation inside `SessionService`. Both multi-family queries lock in family-ID order, so they cannot deadlock with each other. The digest query reads the refresh-token rows without locking them, because a refresh locks its token before its family.
