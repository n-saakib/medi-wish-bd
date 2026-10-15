package bd.mediwish.catalog;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DiscountRepository extends JpaRepository<Discount, UUID> {

    String CANDIDATES = "select d from Discount d where d.endedAt is null and d.startsOn <= :today "
            + "and (d.endsOn is null or d.endsOn >= :today) "
            + "and (d.productId in :productIds or d.categoryId in :categoryIds)";

    @Query(CANDIDATES)
    List<Discount> findCandidates(@Param("today") LocalDate today, @Param("productIds") Collection<UUID> productIds,
            @Param("categoryIds") Collection<UUID> categoryIds);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from Discount d where d.id = :id")
    Optional<Discount> findByIdForUpdate(@Param("id") UUID id);

    @Query("select d from Discount d where d.endedAt is null and d.startsOn <= :today "
            + "and (d.endsOn is null or d.endsOn >= :today) order by d.startsOn desc,d.id")
    Page<Discount> findActive(@Param("today") LocalDate today, Pageable page);

    @Query("select d from Discount d where d.endedAt is null and d.startsOn > :today "
            + "and (d.endsOn is null or d.endsOn >= :today) order by d.startsOn,d.id")
    Page<Discount> findScheduled(@Param("today") LocalDate today, Pageable page);

    @Query("select d from Discount d where d.endedAt is not null or d.endsOn < :today order by d.updatedAt desc,d.id")
    Page<Discount> findEnded(@Param("today") LocalDate today, Pageable page);

    interface Counts {

        Long getActive();

        Long getScheduled();

    }

    @Query("select sum(case when d.endedAt is null and d.startsOn <= :today and "
            + "(d.endsOn is null or d.endsOn >= :today) then 1 else 0 end) as active, "
            + "sum(case when d.endedAt is null and d.startsOn > :today and "
            + "(d.endsOn is null or d.endsOn >= :today) then 1 else 0 end) as scheduled from Discount d")
    Counts countActiveAndScheduled(@Param("today") LocalDate today);

    @Query(value = "select d.* from discounts d where (d.product_id = :productId or d.category_id = :categoryId) "
            + "and d.starts_on <= :today "
            + "and (d.ended_at is null or d.ended_at >= d.starts_on::timestamp at time zone 'Asia/Dhaka') "
            + "order by greatest(d.starts_on::timestamp at time zone 'Asia/Dhaka', "
            + "coalesce(d.ended_at,case when d.ends_on < :today then (d.ends_on + 1)::timestamp "
            + "at time zone 'Asia/Dhaka' end)) desc,d.id limit 20", nativeQuery = true)
    List<Discount> findHistory(@Param("productId") UUID productId, @Param("categoryId") UUID categoryId,
            @Param("today") LocalDate today);

    @Modifying
    @Query(value = "insert into discounts (id,target_type,product_id,category_id,kind,percent,amount,starts_on,ends_on,"
            + "version,created_at,updated_at,created_by,updated_by) values "
            + "(:id,:targetType,:productId,:categoryId,:kind,:percent,:amount,:startsOn,:endsOn,0,:now,:now,:actor,:actor) "
            + "on conflict (id) do nothing", nativeQuery = true)
    int insertIfAbsent(@Param("id") UUID id, @Param("targetType") String targetType, @Param("productId") UUID productId,
            @Param("categoryId") UUID categoryId, @Param("kind") String kind, @Param("percent") BigDecimal percent,
            @Param("amount") BigDecimal amount, @Param("startsOn") LocalDate startsOn,
            @Param("endsOn") LocalDate endsOn, @Param("actor") UUID actor, @Param("now") Instant now);

}
