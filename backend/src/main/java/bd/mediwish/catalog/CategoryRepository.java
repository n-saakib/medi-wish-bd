package bd.mediwish.catalog;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CategoryRepository extends JpaRepository<Category, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Category c where c.id = :id")
    Optional<Category> findByIdForUpdate(@Param("id") UUID id);

    @Query("select c from Category c where :includeInactive = true or c.active = true order by lower(c.name), c.id")
    Page<Category> findPage(@Param("includeInactive") boolean includeInactive, Pageable page);

    @Query("select c from Category c where c.active = true and exists (select p.id from Product p "
            + "where p.category = c and p.active = true and p.sellingPrice is not null) order by lower(c.name), c.id")
    List<Category> findListable();

    interface ProductCount {
        UUID getCategoryId();
        long getProductCount();
    }

    @Query("select p.category.id as categoryId, count(p) as productCount from Product p "
            + "where p.category.id in :ids group by p.category.id")
    List<ProductCount> countProducts(@Param("ids") Collection<UUID> ids);

    @Modifying
    @Query(value = "insert into product_categories "
            + "(id, name, active, version, created_at, updated_at, created_by, updated_by) "
            + "values (:id, :name, true, 0, :now, :now, :actor, :actor) "
            + "on conflict (id) do nothing", nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("name") String name,
                       @Param("actor") UUID actor, @Param("now") Instant now);
}
