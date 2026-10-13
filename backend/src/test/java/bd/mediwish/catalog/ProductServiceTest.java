package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.web.StaleUpdateException;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRepository;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ProductServiceTest {
    private final ProductRepository products = mock(ProductRepository.class);
    private final CategoryRepository categories = mock(CategoryRepository.class);
    private final ProductChangeRepository changes = mock(ProductChangeRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final CurrentPrices prices = mock(CurrentPrices.class);
    private final DiscountHistory discountHistory = mock(DiscountHistory.class);
    private final DiscountCalendar calendar = new DiscountCalendar(Clock.fixed(
            Instant.parse("2026-10-05T00:00:00Z"), ZoneOffset.UTC));
    private final ProductService service = new ProductService(products, categories, changes, users,
            Clock.fixed(Instant.parse("2026-10-05T00:00:00.123456789Z"), ZoneOffset.UTC), prices, discountHistory, calendar);
    private final UUID id = UUID.fromString("256ffb7c-78ba-43ea-8128-43513d42ac7b");
    private final UUID categoryId = UUID.fromString("83a4290b-a567-4c30-a2ef-1ed8b1ba8930");

    @Test
    void catalogAndPricingWritesUseThePersistedTimestampPrecision() {
        var product = editableProduct();
        var changed = new ProductRules.CatalogFields("Changed", null, "Paracetamol", null,
                "Tablet", "Strip", null, categoryId, false, false);

        service.updateCatalog(id, changed, 0L, staff(UserRole.ADMIN));
        service.updatePricing(id, Money.parse("11.50"), null, 0L, staff(UserRole.ADMIN));

        Instant persisted = Instant.parse("2026-10-05T00:00:00.123456Z");
        verify(product).updateCatalog(any(), any(), any(), eq(persisted));
        verify(product).updatePricing(any(), any(), any(), eq(persisted));
        var history = org.mockito.ArgumentCaptor.forClass(ProductChange.class);
        verify(changes, org.mockito.Mockito.times(2)).save(history.capture());
        assertThat(history.getAllValues()).extracting(ProductChange::occurredAt).containsOnly(persisted);
    }

    @Test
    void aModeratorCannotInvokePricingDirectlyEvenWithTheCurrentVersion() {
        when(products.findByIdForUpdate(id)).thenReturn(Optional.of(mock(Product.class)));

        assertThatThrownBy(() -> service.updatePricing(id, Money.parse("11.50"), null, 0L,
                staff(UserRole.MODERATOR))).isInstanceOf(CatalogAccessDeniedException.class);
        verifyNoInteractions(changes, users);
    }

    @Test
    void anUnpricedProductCannotBecomeActive() {
        var product = mock(Product.class);
        var category = mock(Category.class);
        when(category.id()).thenReturn(categoryId);
        when(product.category()).thenReturn(category);
        when(product.kind()).thenReturn(ProductKind.MEDICINE);
        when(product.fields()).thenReturn(fields(false));
        when(products.findByIdForUpdate(id)).thenReturn(Optional.of(product));

        assertThatThrownBy(() -> service.updateCatalog(id, fields(true), 0L, staff(UserRole.MODERATOR)))
                .isInstanceOf(PriceRequiredException.class);
        verify(products, never()).flush();
        verifyNoInteractions(changes, users);
    }

    @Test
    void identicalCatalogRetryPrecedesVersionCheckAndDoesNotWrite() {
        var product = editableProduct();

        var response = service.updateCatalog(id, fields(false), 99L, staff(UserRole.MODERATOR));

        assertThat(response.version()).isZero();
        verify(products, never()).flush();
        verify(changes, never()).save(any());
        verify(users, never()).getReferenceById(any());
        verifyNoInteractions(categories);
    }

    @Test
    void changedCatalogIntentWithAnOldVersionIsStale() {
        editableProduct();
        var changed = new ProductRules.CatalogFields("Changed", null, "Paracetamol", null,
                "Tablet", "Strip", null, categoryId, false, false);

        assertThatThrownBy(() -> service.updateCatalog(id, changed, 99L, staff(UserRole.MODERATOR)))
                .isInstanceOf(StaleUpdateException.class);
        verify(products, never()).flush();
        verifyNoInteractions(changes, users, categories);
    }

    @Test
    void editingAnotherFieldKeepsAnExistingInactiveCategory() {
        var product = editableProduct();
        var changed = new ProductRules.CatalogFields("Changed", null, "Paracetamol", null,
                "Tablet", "Strip", null, categoryId, false, false);

        service.updateCatalog(id, changed, 0L, staff(UserRole.MODERATOR));

        verify(product).updateCatalog(any(), any(), any(), any());
        verifyNoInteractions(categories);
    }

    @Test
    void assigningAnInactiveCategoryIsRefused() {
        editableProduct();
        UUID other = UUID.fromString("5dfef291-865a-4fd6-a26d-92e726f2378d");
        var inactive = mock(Category.class);
        when(categories.findById(other)).thenReturn(Optional.of(inactive));
        var changed = new ProductRules.CatalogFields("Napa", null, "Paracetamol", null,
                "Tablet", "Strip", null, other, false, false);

        assertThatThrownBy(() -> service.updateCatalog(id, changed, 0L, staff(UserRole.MODERATOR)))
                .isInstanceOf(InvalidCatalogException.class);
        verify(products, never()).flush();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   "})
    void equipmentBlankDosageCannotBecomeAnIdenticalRetry(String dosage) {
        var product = editableProduct();
        var stored = new ProductRules.CatalogFields("Equipment", null, null, null, null,
                "Piece", null, categoryId, false, false);
        when(product.kind()).thenReturn(ProductKind.EQUIPMENT);
        when(product.fields()).thenReturn(stored);
        var request = new ProductRules.CatalogFields("Equipment", null, null, null, dosage,
                "Piece", null, categoryId, false, false);

        assertThatThrownBy(() -> service.updateCatalog(id, request, 0L, staff(UserRole.ADMIN)))
                .isInstanceOf(InvalidCatalogException.class);
        assertThatThrownBy(() -> service.updateCatalog(id, request, 99L, staff(UserRole.ADMIN)))
                .isInstanceOf(StaleUpdateException.class);
        verify(products, never()).flush();
        verifyNoInteractions(changes, users, categories);
    }
    @Test
    void listPricesOneBatchAndLeavesUnpricedProductsWithoutDiscountProjection() {
        var product = editableProduct();
        when(products.search(any(), any(), any(), any(), any()))
                .thenReturn(new org.springframework.data.domain.PageImpl<>(java.util.List.of(product)));
        when(prices.forProducts(java.util.List.of(product))).thenReturn(java.util.Map.of());

        var response = service.list(null, null, null, false, 0, 20);

        assertThat(response.items()).hasSize(1);
        assertThat(response.items().getFirst().effectivePrice()).isNull();
        assertThat(response.items().getFirst().appliedDiscount()).isNull();
        verify(prices).forProducts(java.util.List.of(product));
    }

    @Test
    void detailMapsCurrentEffectivePriceAndWinningDiscount() {
        var product = editableProduct();
        when(products.findById(id)).thenReturn(Optional.of(product));
        var discountId = UUID.fromString("11111111-1111-4111-8111-111111111111");
        var price = new EffectivePrice(id, Money.parse("100"), null, Money.parse("90"),
                new java.math.BigDecimal("10.00"), discountId, DiscountTargetType.PRODUCT,
                DiscountKind.PERCENTAGE, java.math.BigDecimal.TEN, calendar.today());
        when(prices.forProducts(java.util.List.of(product), calendar.today()))
                .thenReturn(java.util.Map.of(id, price));

        var response = service.get(id);

        assertThat(response.effectivePrice()).isEqualTo("90.00");
        assertThat(response.appliedDiscount()).isEqualTo(new AppliedDiscount(discountId,
                DiscountTargetType.PRODUCT, "Napa", DiscountKind.PERCENTAGE, "10", "10.00"));
    }

    @Test
    void detailMergesAndCapsHistoryWithStoredRowsFirstAtEqualTimesWithoutWritingDerivedRows() {
        var product = editableProduct();
        when(products.findById(id)).thenReturn(Optional.of(product));
        Instant tie = Instant.parse("2026-10-05T00:00:00Z");
        var stored = mock(ProductChangeRepository.HistoryRow.class);
        when(stored.getOccurredAt()).thenReturn(tie);
        when(stored.getChangeType()).thenReturn(ProductChangeType.PRICE_CHANGED);
        when(changes.findLatest(eq(id), any())).thenReturn(java.util.List.of(stored));
        var derived = java.util.stream.IntStream.range(0, 21).mapToObj(index -> new ProductHistory(
                tie.minusSeconds(index), null, ProductChangeType.DISCOUNT_STARTED,
                null, null, null, null, null, null,
                new HistoryDiscount(DiscountTargetType.CATEGORY, DiscountKind.PERCENTAGE, "10"))).toList();
        when(discountHistory.forProduct(id, categoryId, calendar.today())).thenReturn(derived);

        var response = service.get(id);

        assertThat(response.history()).hasSize(20);
        assertThat(response.history().getFirst().changeType()).isEqualTo(ProductChangeType.PRICE_CHANGED);
        assertThat(response.history().get(1).changeType()).isEqualTo(ProductChangeType.DISCOUNT_STARTED);
        assertThat(response.history().getLast().occurredAt()).isEqualTo(tie.minusSeconds(18));
        verify(changes, never()).save(any());
    }
    private Product editableProduct() {
        var product = mock(Product.class);
        var category = mock(Category.class);
        when(category.id()).thenReturn(categoryId);
        when(category.name()).thenReturn("Old category");
        when(product.category()).thenReturn(category);
        when(product.kind()).thenReturn(ProductKind.MEDICINE);
        when(product.fields()).thenReturn(fields(false));
        when(product.id()).thenReturn(id);
        when(products.findByIdForUpdate(id)).thenReturn(Optional.of(product));
        return product;
    }

    private ProductRules.CatalogFields fields(boolean active) {
        return new ProductRules.CatalogFields("Napa", null, "Paracetamol", null, "Tablet",
                "Strip", null, categoryId, false, active);
    }

    private CurrentUser staff(UserRole role) {
        return new CurrentUser(id, UUID.randomUUID(), new UserProfile("staff", "01700000000", null, false),
                Set.of(role), MfaStatus.VERIFIED, Set.of("ROLE_" + role.name()));
    }
}
