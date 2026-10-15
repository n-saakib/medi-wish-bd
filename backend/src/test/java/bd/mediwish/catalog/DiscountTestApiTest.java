package bd.mediwish.catalog;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class DiscountTestApiTest {
    @Test
    void requestBuildersPreserveOptionalEndAndIncludeOnlyEditableFields() {
        UUID id = UUID.randomUUID();
        UUID target = UUID.randomUUID();
        var body = DiscountTestApi.createBody(id, "PRODUCT", target, "FLAT", "20.00",
                LocalDate.of(2020, 1, 15), null);
        assertThat(body).containsOnlyKeys("id", "targetType", "targetId", "kind", "value", "startsOn", "endsOn")
                .containsEntry("id", id).containsEntry("targetId", target).containsEntry("endsOn", null)
                .containsEntry("startsOn", "2020-01-15");
        body.put("version", 7);
        body.put("updatedByUsername", "synthetic_admin");
        var update = DiscountTestApi.updateBody(body, Map.of("value", "21.00"));
        assertThat(update).containsOnlyKeys("kind", "value", "startsOn", "endsOn", "version")
                .containsEntry("value", "21.00").containsEntry("version", 7).containsEntry("endsOn", null);
        assertThat(body).containsEntry("value", "20.00");
    }
}
