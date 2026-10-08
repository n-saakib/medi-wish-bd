package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.user.UserRole;

final class CatalogAuthorization {
    private CatalogAuthorization() {}

    static void require(CurrentUser current, CatalogArea area) {
        if (current == null || current.mfa() != MfaStatus.VERIFIED
                || !ProductRules.canEdit(effectiveRole(current), area)) {
            throw new CatalogAccessDeniedException();
        }
    }

    static UserRole effectiveRole(CurrentUser current) {
        if (current.roles().contains(UserRole.ADMIN)) return UserRole.ADMIN;
        if (current.roles().contains(UserRole.MODERATOR)) return UserRole.MODERATOR;
        if (current.roles().contains(UserRole.DELIVERY_PERSON)) return UserRole.DELIVERY_PERSON;
        return UserRole.CUSTOMER;
    }
}
