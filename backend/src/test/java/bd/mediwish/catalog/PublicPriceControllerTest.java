package bd.mediwish.catalog;

import bd.mediwish.web.WebTestFixtures;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import tools.jackson.databind.json.JsonMapper;

class PublicPriceControllerTest {
    private static final UUID ID = UUID.fromString("0d6f3b0e-7f4a-4b7e-9a51-2a2f3c4d5e6f");
    private final CurrentPrices prices = mock(CurrentPrices.class);
    private final org.springframework.test.web.servlet.MockMvc mvc = WebTestFixtures.catalogMvc(new PublicPriceController(prices));

    @Test
    void exposesOnlyTheAcceptedAnonymousPriceProjection() throws Exception {
        when(prices.forActiveProduct(ID)).thenReturn(Optional.of(new EffectivePrice(ID, Money.parse("150"), Money.parse("160"),
                Money.parse("135"), new BigDecimal("15.00"), UUID.randomUUID(), DiscountTargetType.CATEGORY,
                DiscountKind.PERCENTAGE, new BigDecimal("10.00"), LocalDate.of(2030, 1, 15))));
        var response = mvc.perform(get("/api/products/" + ID + "/price").header("Authorization", "Bearer irrelevant"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID")).andReturn().getResponse();
        var json = JsonMapper.builder().build();
        assertThat(json.readTree(response.getContentAsString())).isEqualTo(json.readTree("""
                {"productId":"%s","sellingPrice":"150.00","mrp":"160.00","price":"135.00","saving":"15.00",
                "discount":{"targetType":"CATEGORY","kind":"PERCENTAGE","value":"10"}}
                """.formatted(ID)));
    }

    @Test
    void malformedUnknownInactiveAndUnpricedProductsShareNotFound() throws Exception {
        when(prices.forActiveProduct(ID)).thenReturn(Optional.empty());
        for (String id : new String[]{ID.toString(), "malformed"}) {
            mvc.perform(get("/api/products/" + id + "/price")).andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        }
        verify(prices, times(1)).forActiveProduct(ID);
    }

    @Test
    void undiscountedPriceKeepsANullDiscountAndMrp() throws Exception {
        when(prices.forActiveProduct(ID)).thenReturn(Optional.of(new EffectivePrice(ID, Money.parse("150"), null,
                Money.parse("150"), new BigDecimal("0.00"), null, null, null, null, LocalDate.of(2030, 1, 15))));
        mvc.perform(get("/api/products/" + ID + "/price")).andExpect(status().isOk())
                .andExpect(jsonPath("$.discount").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.mrp").value(org.hamcrest.Matchers.nullValue())).andExpect(jsonPath("$.saving").value("0.00"));
    }
}
