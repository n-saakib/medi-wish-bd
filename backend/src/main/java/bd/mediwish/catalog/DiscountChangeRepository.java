package bd.mediwish.catalog;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface DiscountChangeRepository extends JpaRepository<DiscountChange, UUID> {

}
