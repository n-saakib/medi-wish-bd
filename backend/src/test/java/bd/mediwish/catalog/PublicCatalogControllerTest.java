package bd.mediwish.catalog;

import bd.mediwish.web.WebTestFixtures;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Public HTTP contract with a controlled read model; database behavior is covered by PublicCatalogIT. */
class PublicCatalogControllerTest {
    private static final UUID ID = UUID.fromString("0b9c2f2e-4a51-4d1e-9a65-3f1e2d7c1a01");
    private final PublicCatalogService service = mock(PublicCatalogService.class);
    private final MockMvc mvc = WebTestFixtures.catalogMvc(new PublicCatalogController(service));

    @Test
    void categoriesSerializeOnlyThePublicList() throws Exception {
        when(service.categories()).thenReturn(new PublicCategoryList(List.of(new PublicCategory(ID, "Synthetic care"))));
        mvc.perform(get("/api/categories").header("Authorization", "Bearer ignored"))
                .andExpect(status().isOk())
                .andExpect(content().json("{" +
                        "\"categories\":[{\"id\":\"" + ID + "\",\"name\":\"Synthetic care\"}]}"));
        verify(service).categories();
    }

    @Test
    void categoryPageDefaultsToZeroAndIgnoresUnknownQueryParameters() throws Exception {
        var page = new PublicCategoryPage(new PublicCategory(ID, "Synthetic care"), List.of(), 0, 24, 0);
        when(service.categoryPage(ID, 0)).thenReturn(page);
        mvc.perform(get("/api/categories/{id}/products", ID).param("size", "50"))
                .andExpect(status().isOk())
                .andExpect(content().json("{" +
                        "\"category\":{\"id\":\"" + ID + "\",\"name\":\"Synthetic care\"}," +
                        "\"items\":[],\"page\":0,\"size\":24,\"totalItems\":0}"));
        verify(service).categoryPage(ID, 0);
    }

    @Test
    void canonicalPageIsPassedToReadModelAndPastLastIsTheSameNotFound() throws Exception {
        when(service.categoryPage(ID, 9)).thenThrow(new CatalogNotFoundException());
        mvc.perform(get("/api/categories/{id}/products", ID).param("page", "9"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"))
                .andExpect(header().exists("X-Request-ID"));
        verify(service).categoryPage(ID, 9);
        when(service.categoryPage(ID, 999999999)).thenThrow(new CatalogNotFoundException());
        mvc.perform(get("/api/categories/{id}/products", ID).param("page", "999999999"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        verify(service).categoryPage(ID, 999999999);
    }

    @Test
    void malformedAndRepeatedPagesAreNotFoundBeforeTheReadModel() throws Exception {
        for (String value : List.of("", "00", "01", "-1", "+1", "1.0", " 1", "1 ", "1,2", "1000000000")) {
            mvc.perform(get("/api/categories/{id}/products", ID).param("page", value))
                    .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        }
        mvc.perform(get("/api/categories/{id}/products", ID).param("page", "1", "0"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        verifyNoInteractions(service);
    }

    @Test
    void malformedIdsAreNotFoundBeforeTheReadModel() throws Exception {
        mvc.perform(get("/api/categories/not-a-uuid/products"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(get("/api/products/not-a-uuid"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        verifyNoInteractions(service);
    }

    @Test
    void productDetailsSerializeOnlyThePublicProjection() throws Exception {
        var details = new PublicProductDetails(ID, "Synthetic product", null, null, null, null,
                "1 unit", "Plain description", false, null, List.of(),
                new PublicPriceView("11.50", null, "11.50", "0.00", null));
        when(service.product(ID)).thenReturn(details);
        mvc.perform(get("/api/products/{id}", ID))
                .andExpect(status().isOk())
                .andExpect(content().json("{" +
                        "\"id\":\"" + ID + "\",\"name\":\"Synthetic product\"," +
                        "\"brandName\":null,\"genericName\":null,\"dosageForm\":null," +
                        "\"manufacturer\":null,\"saleUnit\":\"1 unit\"," +
                        "\"description\":\"Plain description\",\"requireValidation\":false," +
                        "\"category\":null,\"images\":[],\"price\":{" +
                        "\"sellingPrice\":\"11.50\",\"mrp\":null,\"price\":\"11.50\"," +
                        "\"saving\":\"0.00\",\"discount\":null}}", true));
        verify(service).product(ID);
    }
}
