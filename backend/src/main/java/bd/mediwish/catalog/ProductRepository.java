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

public interface ProductRepository extends JpaRepository<Product, UUID> {
    interface ProductName {
        UUID getProductId();
        String getName();
    }

    @Query("select p.id as productId, p.name as name from Product p where p.id in :ids")
    List<ProductName> findNamesById(@Param("ids") Collection<UUID> ids);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Product p where p.id = :id")
    Optional<Product> findByIdForUpdate(@Param("id") UUID id);

    @Query(value = "select p from Product p join fetch p.category c where "
            + "(:pattern is null or lower(p.name) like :pattern escape '!' "
            + "or lower(coalesce(p.brandName, '')) like :pattern escape '!' "
            + "or lower(coalesce(p.genericName, '')) like :pattern escape '!') "
            + "and (:categoryId is null or c.id = :categoryId) "
            + "and (:status is null or :status = 'ACTIVE' and p.active = true "
            + "or :status = 'INACTIVE' and p.active = false and p.sellingPrice is not null "
            + "or :status = 'NEEDS_PRICE' and p.active = false and p.sellingPrice is null) "
            + "and (:reviewRequired is null or p.requireValidation = :reviewRequired) "
            + "order by lower(p.name), p.id",
            countQuery = "select count(p) from Product p where "
                    + "(:pattern is null or lower(p.name) like :pattern escape '!' "
                    + "or lower(coalesce(p.brandName, '')) like :pattern escape '!' "
                    + "or lower(coalesce(p.genericName, '')) like :pattern escape '!') "
                    + "and (:categoryId is null or p.category.id = :categoryId) "
                    + "and (:status is null or :status = 'ACTIVE' and p.active = true "
                    + "or :status = 'INACTIVE' and p.active = false and p.sellingPrice is not null "
                    + "or :status = 'NEEDS_PRICE' and p.active = false and p.sellingPrice is null) "
                    + "and (:reviewRequired is null or p.requireValidation = :reviewRequired)")
    Page<Product> search(@Param("pattern") String pattern, @Param("categoryId") UUID categoryId,
                         @Param("status") String status, @Param("reviewRequired") Boolean reviewRequired,
                         Pageable page);

    @Modifying
    @Query(value = "insert into products (id, kind, name, brand_name, generic_name, manufacturer, "
            + "dosage_form, sale_unit, description, category_id, selling_price, mrp, active, "
            + "require_validation, version, created_at, updated_at, created_by, updated_by) "
            + "select :id, :kind, :name, :brand, :generic, :manufacturer, :dosage, :saleUnit, "
            + ":description, c.id, null, null, false, :requireValidation, 0, :now, :now, :actor, :actor "
            + "from product_categories c where c.id = :categoryId and c.active = true "
            + "on conflict (id) do nothing", nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("kind") String kind,
                       @Param("name") String name, @Param("brand") String brand,
                       @Param("generic") String generic, @Param("manufacturer") String manufacturer,
                       @Param("dosage") String dosage, @Param("saleUnit") String saleUnit,
                       @Param("description") String description, @Param("categoryId") UUID categoryId,
                       @Param("requireValidation") boolean requireValidation,
                       @Param("actor") UUID actor, @Param("now") Instant now);
}
