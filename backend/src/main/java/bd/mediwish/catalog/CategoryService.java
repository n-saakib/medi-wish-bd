package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class CategoryService {
    private final CategoryRepository categories;
    private final Clock clock;

    CategoryService(CategoryRepository categories, Clock clock) {
        this.categories = categories;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    CatalogPage<CategoryView> list(boolean includeInactive, int page, int size) {
        page(page, size);
        var found = categories.findPage(includeInactive, PageRequest.of(page, size));
        var ids = found.getContent().stream().map(Category::id).toList();
        Map<UUID, Long> counts = ids.isEmpty() ? Map.of() : categories.countProducts(ids).stream()
                .collect(Collectors.toMap(CategoryRepository.ProductCount::getCategoryId,
                        CategoryRepository.ProductCount::getProductCount));
        return new CatalogPage<>(found.getContent().stream()
                .map(category -> view(category, counts.getOrDefault(category.id(), 0L))).toList(),
                page, size, found.getTotalElements());
    }

    @Transactional
    CatalogCreation<CategoryView> create(UUID id, String submittedName, CurrentUser current) {
        if (id == null) throw new InvalidCatalogException("id");
        String name = name(submittedName);
        CatalogAuthorization.require(current, CatalogArea.CATEGORIES);
        int inserted = categories.insertIfAbsent(id, name, current.userId(), clock.instant());
        Category stored = categories.findById(id).orElseThrow(CatalogNotFoundException::new);
        if (inserted == 0 && !stored.name().equals(name)) throw new IdConflictException();
        return new CatalogCreation<>(view(stored, count(stored.id())), inserted == 1);
    }

    @Transactional
    CategoryView update(UUID id, String submittedName, Boolean active, Long version, CurrentUser current) {
        if (id == null || submittedName == null || active == null || version == null || version < 0) {
            throw new InvalidCatalogException("category");
        }
        Category stored = categories.findByIdForUpdate(id).orElseThrow(CatalogNotFoundException::new);
        CatalogAuthorization.require(current, CatalogArea.CATEGORIES);
        String normalized = submittedName.chars().anyMatch(Character::isISOControl)
                ? submittedName : submittedName.trim();
        if (stored.name().equals(normalized) && stored.active() == active) return view(stored, count(id));
        if (stored.version() != version) throw new StaleUpdateException();
        String name = name(submittedName);
        stored.update(name, active, current.userId(), clock.instant());
        categories.flush();
        return view(stored, count(id));
    }

    static void page(int page, int size) {
        if (page < 0 || size < 1 || size > 50 || (long) page * size > Integer.MAX_VALUE) {
            throw new InvalidCatalogException("page");
        }
    }

    static String name(String value) {
        if (value == null || value.chars().anyMatch(Character::isISOControl)) {
            throw new InvalidCatalogException("name");
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty() || trimmed.length() > 80) {
            throw new InvalidCatalogException("name");
        }
        return trimmed;
    }

    private long count(UUID id) {
        return categories.countProducts(java.util.List.of(id)).stream()
                .mapToLong(CategoryRepository.ProductCount::getProductCount).findFirst().orElse(0);
    }

    private static CategoryView view(Category category, long count) {
        return new CategoryView(category.id(), category.name(), category.active(), count, category.version());
    }
}
