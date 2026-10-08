package bd.mediwish.catalog;

import bd.mediwish.web.StaleUpdateException;
import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CategoryServiceTest {
    private final CategoryRepository repository = mock(CategoryRepository.class);
    private final CategoryService service = new CategoryService(repository,
            Clock.fixed(Instant.parse("2026-10-05T00:00:00Z"), ZoneOffset.UTC));
    private final UUID id = UUID.fromString("f04e3668-068b-451f-9648-8cbe8ce90fc9");

    @ParameterizedTest
    @CsvSource({"107374183,20", "42949673,50", "2147483647,2", "2147483647,50"})
    void pageOffsetsBeyondThePersistenceLimitAreInvalidBeforeDatabaseAccess(int page, int size) {
        assertThatThrownBy(() -> service.list(true, page, size))
                .isInstanceOf(InvalidCatalogException.class);
        verifyNoInteractions(repository);
    }

    @ParameterizedTest
    @CsvSource({"2147483647,1", "107374182,20", "42949672,50"})
    void representablePageOffsetsRemainValidEvenPastTheLastRecord(int page, int size) {
        when(repository.findPage(true, PageRequest.of(page, size)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(page, size), 0));
        var result = service.list(true, page, size);
        assertThat(result.items()).isEmpty();
        assertThat(result.page()).isEqualTo(page);
        assertThat(result.size()).isEqualTo(size);
        assertThat(result.totalItems()).isZero();
    }

    @Test
    void repeatedCreateWithTheSameIdAndNormalizedNameReturnsTheExistingCategory() {
        var stored = new Category(id, "Pain relief", id, Instant.parse("2026-10-05T00:00:00Z"));
        when(repository.insertIfAbsent(eq(id), eq("Pain relief"), eq(id), any())).thenReturn(0);
        when(repository.findById(id)).thenReturn(Optional.of(stored));

        var result = service.create(id, " Pain relief ", staff(UserRole.MODERATOR));

        assertThat(result.created()).isFalse();
        assertThat(result.value().name()).isEqualTo("Pain relief");
    }

    @Test
    void repeatedCreateWithDifferentContentIsAConflict() {
        var stored = new Category(id, "Pain relief", id, Instant.parse("2026-10-05T00:00:00Z"));
        when(repository.insertIfAbsent(eq(id), eq("Different"), eq(id), any())).thenReturn(0);
        when(repository.findById(id)).thenReturn(Optional.of(stored));

        assertThatThrownBy(() -> service.create(id, "Different", staff(UserRole.ADMIN)))
                .isInstanceOf(IdConflictException.class);
    }

    @Test
    void aCustomerCannotInvokeTheCategoryServiceDirectly() {
        assertThatThrownBy(() -> service.create(id, "Pain relief", staff(UserRole.CUSTOMER)))
                .isInstanceOf(CatalogAccessDeniedException.class);
        verifyNoInteractions(repository);
    }

    @Test
    void unchangedCategoryRetrySucceedsWithAnOldVersionButChangedIntentIsStale() {
        var stored = new Category(id, "Pain relief", id, Instant.parse("2026-10-05T00:00:00Z"));
        when(repository.findByIdForUpdate(id)).thenReturn(Optional.of(stored));

        var identical = service.update(id, " Pain relief ", true, 99L, staff(UserRole.MODERATOR));
        assertThat(identical.version()).isZero();
        verify(repository, never()).flush();

        assertThatThrownBy(() -> service.update(id, "Other", true, 99L, staff(UserRole.MODERATOR)))
                .isInstanceOf(StaleUpdateException.class);
        assertThatThrownBy(() -> service.update(id, "x".repeat(81), true, 99L, staff(UserRole.MODERATOR)))
                .isInstanceOf(StaleUpdateException.class);
        verify(repository, never()).flush();
    }

    private CurrentUser staff(UserRole role) {
        return new CurrentUser(id, UUID.randomUUID(), new UserProfile("staff", "01700000000", null, false),
                Set.of(role), MfaStatus.VERIFIED, Set.of("ROLE_" + role.name()));
    }

    @Test
    void categoryNamesCannotHideControlsThroughTrimmingOrNoOpDetection() {
        var stored = new Category(id, "Pain relief", id, Instant.parse("2026-10-05T00:00:00Z"));
        when(repository.findByIdForUpdate(id)).thenReturn(Optional.of(stored));
        for (String value : new String[] {"\u0000Pain relief", "Pain relief\u0000", "Pain relief\n"}) {
            assertThatThrownBy(() -> CategoryService.name(value)).isInstanceOf(InvalidCatalogException.class);
            assertThatThrownBy(() -> service.update(id, value, true, 0L, staff(UserRole.MODERATOR)))
                    .isInstanceOf(InvalidCatalogException.class);
            assertThatThrownBy(() -> service.update(id, value, true, 99L, staff(UserRole.MODERATOR)))
                    .isInstanceOf(StaleUpdateException.class);
        }
        verify(repository, never()).flush();
    }
}
