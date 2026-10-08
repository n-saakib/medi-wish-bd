package bd.mediwish.catalog;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.time.Instant;
import java.math.BigDecimal;
import java.util.UUID;

public interface ProductChangeRepository extends JpaRepository<ProductChange, UUID> {
    interface HistoryRow {
        Instant getOccurredAt();
        String getActorUsername();
        ProductChangeType getChangeType();
        BigDecimal getOldSellingPrice();
        BigDecimal getNewSellingPrice();
        BigDecimal getOldMrp();
        BigDecimal getNewMrp();
        Boolean getOldRequireValidation();
        Boolean getNewRequireValidation();
    }

    @Query("select change.occurredAt as occurredAt, actor.username as actorUsername, "
            + "change.changeType as changeType, change.oldSellingPrice as oldSellingPrice, "
            + "change.newSellingPrice as newSellingPrice, change.oldMrp as oldMrp, change.newMrp as newMrp, "
            + "change.oldRequireValidation as oldRequireValidation, "
            + "change.newRequireValidation as newRequireValidation "
            + "from ProductChange change left join change.actor actor "
            + "where change.productId = :productId order by change.occurredAt desc, change.id desc")
    List<HistoryRow> findLatest(@Param("productId") UUID productId, Pageable page);
}
