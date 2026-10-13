package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import bd.mediwish.web.StaleUpdateException;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DiscountServiceTest {
    private final DiscountRepository discounts = mock(DiscountRepository.class);
    private final DiscountChangeRepository changes = mock(DiscountChangeRepository.class);
    private final ProductRepository products = mock(ProductRepository.class);
    private final CategoryRepository categories = mock(CategoryRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final DiscountCalendar calendar = mock(DiscountCalendar.class);
    private final Instant now = Instant.parse("2026-10-09T00:00:00.123456789Z");
    private final LocalDate today = LocalDate.of(2026, 10, 9);
    private final UUID categoryId = UUID.randomUUID();
    private final UUID id = UUID.randomUUID();
    private final DiscountService service = new DiscountService(discounts, changes, products, categories,
            users, calendar, Clock.fixed(now, ZoneOffset.UTC));
    private CurrentUser actor(UserRole role, MfaStatus mfa) {
        return new CurrentUser(UUID.randomUUID(), UUID.randomUUID(),
                new UserProfile("synthetic.staff", "01700000000", null, false), Set.of(role), mfa, Set.of());
    }
    private Discount stored() {
        return new Discount(id, DiscountTargetType.CATEGORY, categoryId, DiscountKind.PERCENTAGE,
                new BigDecimal("10.00"), today, null, null, now);
    }
    private DiscountRequests.DiscountCreate create() {
        return new DiscountRequests.DiscountCreate(id, DiscountTargetType.CATEGORY, categoryId,
                DiscountKind.PERCENTAGE, BigDecimal.TEN, today, null);
    }
    @Test void onlyAVerifiedAdminCanInvokeCommandsBeforeAnyPersistenceAccess() {
        assertThatThrownBy(() -> service.create(create(), actor(UserRole.MODERATOR, MfaStatus.VERIFIED)))
                .isInstanceOf(CatalogAccessDeniedException.class);
        assertThatThrownBy(() -> service.create(create(), actor(UserRole.ADMIN, MfaStatus.VERIFICATION_REQUIRED)))
                .isInstanceOf(CatalogAccessDeniedException.class);
        verifyNoInteractions(discounts, changes, products, categories, users, calendar);
    }
    @Test void newCreateRecordsExactlyOneChangeAndUsesMicrosecondTimestamps() {
        var category = mock(Category.class);
        when(category.active()).thenReturn(true);
        when(categories.findById(categoryId)).thenReturn(Optional.of(category));
        when(calendar.today()).thenReturn(today);
        when(discounts.findById(id)).thenReturn(Optional.empty(), Optional.of(stored()));
        when(discounts.insertIfAbsent(eq(id), anyString(), isNull(), eq(categoryId), anyString(),
                any(), isNull(), eq(today), isNull(), any(), any())).thenReturn(1);
        assertThat(service.create(create(), actor(UserRole.ADMIN, MfaStatus.VERIFIED)).created()).isTrue();
        var capture = org.mockito.ArgumentCaptor.forClass(DiscountChange.class);
        verify(changes).save(capture.capture());
        assertThat(capture.getValue().changeType()).isEqualTo(DiscountChangeType.CREATED);
        assertThat(capture.getValue().occurredAt()).isEqualTo(Instant.parse("2026-10-09T00:00:00.123456Z"));
    }
    @Test void createReplayPrecedesCalendarAndTargetStateRules() {
        when(calendar.today()).thenReturn(today.plusDays(4));
        when(discounts.findById(id)).thenReturn(Optional.of(stored()));
        assertThat(service.create(create(), actor(UserRole.ADMIN, MfaStatus.VERIFIED)).created()).isFalse();
        verify(categories, never()).findById(any());
        verify(discounts, never()).insertIfAbsent(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
        verifyNoInteractions(changes);
    }
    @Test void createReplayWithChangedIntentConflicts() {
        when(calendar.today()).thenReturn(today);
        when(discounts.findById(id)).thenReturn(Optional.of(stored()));
        var request = new DiscountRequests.DiscountCreate(id, DiscountTargetType.CATEGORY, categoryId,
                DiscountKind.PERCENTAGE, new BigDecimal("11"), today, null);
        assertThatThrownBy(() -> service.create(request, actor(UserRole.ADMIN, MfaStatus.VERIFIED)))
                .isInstanceOf(IdConflictException.class);
        verifyNoInteractions(changes);
    }
    @Test void identicalUpdatePrecedesVersionAndChangedIntentIsStale() {
        when(calendar.today()).thenReturn(today);
        when(discounts.findByIdForUpdate(id)).thenReturn(Optional.of(stored()));
        var admin = actor(UserRole.ADMIN, MfaStatus.VERIFIED);
        assertThat(service.update(id, new DiscountRequests.DiscountUpdate(DiscountKind.PERCENTAGE,
                BigDecimal.TEN, today, null, 99), admin).version()).isZero();
        assertThatThrownBy(() -> service.update(id, new DiscountRequests.DiscountUpdate(DiscountKind.PERCENTAGE,
                new BigDecimal("11"), today, null, 99), admin)).isInstanceOf(StaleUpdateException.class);
        verifyNoInteractions(changes);
        verify(discounts, never()).flush();
    }
    @Test void endingAnAlreadyEndedDiscountIsAReadOnlyReplayWhateverTheVersion() {
        var discount = stored();
        discount.end(null, now);
        when(calendar.today()).thenReturn(today);
        when(discounts.findByIdForUpdate(id)).thenReturn(Optional.of(discount));
        assertThat(service.end(id, 99, actor(UserRole.ADMIN, MfaStatus.VERIFIED)).status()).isEqualTo(DiscountStatus.ENDED);
        verifyNoInteractions(changes);
        verify(discounts, never()).flush();
    }
    @Test void tabCountsAreIndependentOfTheSelectedStatusAndCaptureTodayOncePerRequest() {
        when(calendar.today()).thenReturn(today);
        var counts = mock(DiscountRepository.Counts.class);
        when(counts.getActive()).thenReturn(3L);
        when(counts.getScheduled()).thenReturn(5L);
        when(discounts.countActiveAndScheduled(today)).thenReturn(counts);
        when(discounts.findActive(eq(today), any())).thenReturn(new PageImpl<>(List.of()));
        when(discounts.findScheduled(eq(today), any())).thenReturn(new PageImpl<>(List.of()));
        when(discounts.findEnded(eq(today), any())).thenReturn(new PageImpl<>(List.of()));
        for (DiscountStatus status : DiscountStatus.values()) {
            assertThat(service.list(status, 0, 20, actor(UserRole.ADMIN, MfaStatus.VERIFIED)).counts())
                    .isEqualTo(new DiscountCounts(3, 5));
        }
        verify(discounts, times(3)).countActiveAndScheduled(today);
        verify(calendar, times(3)).today();
    }
}
