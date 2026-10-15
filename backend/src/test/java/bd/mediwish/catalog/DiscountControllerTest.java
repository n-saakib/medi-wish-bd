package bd.mediwish.catalog;

import bd.mediwish.web.WebTestFixtures;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.json.JsonMapper;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class DiscountControllerTest {
    private static final UUID ID = UUID.fromString("0d6f3b0e-7f4a-4b7e-9a51-2a2f3c4d5e6f");
    private static final UUID TARGET = UUID.fromString("5b1c8011-01aa-4bee-9aaa-111111111111");
    private static final String CREATE = """
            {"id":"%s","targetType":"CATEGORY","targetId":"%s","kind":"PERCENTAGE",
             "value":"10","startsOn":"2030-01-15","endsOn":null}
            """.formatted(ID, TARGET);
    private final DiscountService discounts = mock(DiscountService.class);
    private final MockMvc mvc = WebTestFixtures.catalogMvc(new DiscountController(discounts));

    @ParameterizedTest
    @ValueSource(strings = {"extra", "number", "array"})
    void rejectsUnknownKeysAndNonStringValuesBeforeCallingService(String failure) throws Exception {
        String body = failure.equals("extra") ? CREATE.replace("\"endsOn\":null", "\"extra\":true,\"endsOn\":null")
                : failure.equals("number") ? CREATE.replace("\"value\":\"10\"", "\"value\":10") : "[]";
        mvc.perform(post("/api/staff/discounts").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(discounts);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "?status=unknown", "?status=ACTIVE&size=0", "?status=ACTIVE&size=51"})
    void rejectsMissingStatusUnknownStatusAndOutOfRangePageSize(String query) throws Exception {
        mvc.perform(get("/api/staff/discounts" + query)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(discounts);
    }

    @Test
    void createsThenReplaysWithExactDiscountProjection() throws Exception {
        when(discounts.create(any(), isNull())).thenReturn(new CatalogCreation<>(view(), true), new CatalogCreation<>(view(), false));
        for (int expected : new int[]{201, 200}) {
            var response = mvc.perform(post("/api/staff/discounts").contentType(MediaType.APPLICATION_JSON).content(CREATE))
                    .andExpect(status().is(expected)).andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(header().exists("X-Request-ID")).andReturn().getResponse();
            assertThat(JsonMapper.builder().build().readTree(response.getContentAsString())).isEqualTo(
                    JsonMapper.builder().build().readTree("""
                    {"id":"%s","targetType":"CATEGORY","targetId":"%s","targetName":"Synthetic supplies",
                    "productCount":3,"kind":"PERCENTAGE","value":"10","startsOn":"2030-01-15",
                    "endsOn":null,"status":"ACTIVE","version":0,"updatedAt":"2030-01-15T00:00:00Z",
                    "updatedByUsername":"discount.admin"}
                    """.formatted(ID, TARGET)));
        }
    }

    @Test
    void listsWithCountsAndForwardsTheRequestedStatusAndPagination() throws Exception {
        when(discounts.list(DiscountStatus.ACTIVE, 0, 20, null)).thenReturn(new DiscountPage(List.of(view()), 0, 20, 1, new DiscountCounts(1, 2)));
        mvc.perform(get("/api/staff/discounts?status=ACTIVE")).andExpect(status().isOk())
                .andExpect(jsonPath("$.counts.active").value(1)).andExpect(jsonPath("$.counts.scheduled").value(2))
                .andExpect(jsonPath("$.totalItems").value(1)).andExpect(jsonPath("$.items[0].id").value(ID.toString()));
    }

    @Test
    void updatesAndEndsWithParsedVersion() throws Exception {
        when(discounts.update(eq(ID), any(), isNull())).thenReturn(view());
        when(discounts.end(ID, 7, null)).thenReturn(view());
        mvc.perform(put("/api/staff/discounts/" + ID).contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"PERCENTAGE\",\"value\":\"10\",\"startsOn\":\"2030-01-15\",\"endsOn\":null,\"version\":7}"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/staff/discounts/" + ID + "/end").contentType(MediaType.APPLICATION_JSON).content("{\"version\":7}"))
                .andExpect(status().isOk());
        verify(discounts).end(ID, 7, null);
    }

    private static DiscountView view() {
        return new DiscountView(ID, DiscountTargetType.CATEGORY, TARGET, "Synthetic supplies", 3L,
                DiscountKind.PERCENTAGE, "10", LocalDate.of(2030, 1, 15), null, DiscountStatus.ACTIVE,
                0, Instant.parse("2030-01-15T00:00:00Z"), "discount.admin");
    }
}
