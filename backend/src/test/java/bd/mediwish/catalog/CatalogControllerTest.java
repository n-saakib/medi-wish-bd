package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.user.UserProfile;
import bd.mediwish.user.UserRole;
import bd.mediwish.web.WebTestFixtures;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class CatalogControllerTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final UUID CATEGORY_ID = UUID.fromString("0b8e3f52-9c1a-4d67-a2e4-7f3b5c9d1e20");
    private static final UUID PRODUCT_ID = UUID.fromString("6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14");
    private static final Instant NOW = Instant.parse("2026-10-06T00:00:00Z");
    private static final String CATEGORY_CREATE = "{\"id\":\"" + CATEGORY_ID + "\",\"name\":\"Synthetic supplies\"}";
    private static final String CATEGORY_UPDATE = "{\"name\":\"Synthetic supplies\",\"active\":false,\"version\":2}";
    private static final String PRODUCT_CREATE = """
            {"id":"%s","kind":"MEDICINE","name":"Synthetic medicine","brandName":"Synthetic brand",
             "genericName":"Synthetic compound","manufacturer":"Synthetic maker","dosageForm":"Tablet 5 mg",
             "saleUnit":"Strip of 10 tablets","description":"Synthetic description",
             "categoryId":"%s","requireValidation":false}
            """.formatted(PRODUCT_ID, CATEGORY_ID);
    private static final String PRODUCT_RESPONSE = """
            {"id":"%s","kind":"MEDICINE","name":"Synthetic medicine","brandName":"Synthetic brand",
             "genericName":"Synthetic compound","dosageForm":"Tablet 5 mg","manufacturer":"Synthetic maker",
             "categoryId":"%s","categoryName":"Synthetic supplies","saleUnit":"Strip of 10 tablets",
             "sellingPrice":null,"mrp":null,"active":false,"requireValidation":false,"status":"NEEDS_PRICE",
             "description":"Synthetic description","version":0,"updatedAt":"2026-10-06T00:00:00Z",
             "updatedByUsername":"catalog.admin","history":[{"occurredAt":"2026-10-06T00:00:00Z",
             "actorUsername":"catalog.admin","changeType":"CREATED","oldSellingPrice":null,
             "newSellingPrice":null,"oldMrp":null,"newMrp":null,"oldRequireValidation":null,
             "newRequireValidation":false}]}
            """.formatted(PRODUCT_ID, CATEGORY_ID);
    private static final String PRODUCT_UPDATE = changed(changed(removed(removed(PRODUCT_CREATE, "id"), "kind"),
            "active", "true"), "version", "7");
    private static final String PRICING_UPDATE = "{\"sellingPrice\":\"11.5\",\"mrp\":\"12\",\"version\":7}";
    private static final CurrentUser ADMIN = new CurrentUser(UUID.randomUUID(), UUID.randomUUID(),
            new UserProfile("catalog.admin", "01700000000", null, false), Set.of(UserRole.ADMIN),
            MfaStatus.VERIFIED, Set.of("ROLE_ADMIN"));
    private final CategoryService categories = mock(CategoryService.class);
    private final ProductService products = mock(ProductService.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(ADMIN, null, java.util.List.of()));
        mvc = WebTestFixtures.catalogMvc(new CatalogController(categories, products));
    }

    @AfterEach
    void clearPrincipal() { SecurityContextHolder.clearContext(); }

    @Test
    void categoryListDefaultsIncludeInactiveAndReturnExactlyThePublicPage() throws Exception {
        when(categories.list(true, 0, 20)).thenReturn(new CatalogPage<>(
                List.of(new CategoryView(CATEGORY_ID, "Synthetic supplies", false, 4, 2)), 0, 20, 1));

        var response = mvc.perform(get("/api/staff/categories"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree("""
                {"items":[{"id":"%s","name":"Synthetic supplies","active":false,"productCount":4,
                "version":2}],"page":0,"size":20,"totalItems":1}
                """.formatted(CATEGORY_ID)));
    }

    @Test
    void categoryListPassesExplicitFiltersAndReturnsAnEmptyPagePastTheEnd() throws Exception {
        when(categories.list(false, 2, 50)).thenReturn(new CatalogPage<>(List.of(), 2, 50, 1));

        var response = mvc.perform(get("/api/staff/categories").param("includeInactive", "false")
                        .param("page", "2").param("size", "50").param("inStock", "PRIVATE_QUERY"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree(
                "{\"items\":[],\"page\":2,\"size\":50,\"totalItems\":1}"));
    }

    @ParameterizedTest(name = "{0}={1}")
    @MethodSource("invalidCategoryQueries")
    void invalidCategoryListQueryIsBoundedBeforeServiceCalls(String key, String value) throws Exception {
        invalid(get("/api/staff/categories").param(key, value));
    }

    private static Stream<Arguments> invalidCategoryQueries() {
        List<Arguments> cases = new ArrayList<>();
        for (String key : List.of("page", "size")) {
            for (String value : List.of("", "-1", "1.5", "PRIVATE_QUERY", "2147483648")) {
                cases.add(Arguments.of(key, value));
            }
        }
        for (String value : List.of("0", "51")) cases.add(Arguments.of("size", value));
        for (String value : List.of("", "1", "on", "TRUE", "PRIVATE_QUERY")) {
            cases.add(Arguments.of("includeInactive", value));
        }
        return cases.stream();
    }

    @Test
    void productListDefaultsReturnExactlyThePublicSummaryPage() throws Exception {
        when(products.list(null, null, null, false, 0, 20)).thenReturn(new CatalogPage<>(List.of(
                new ProductSummary(PRODUCT_ID, ProductKind.MEDICINE, "Synthetic medicine", "Synthetic brand",
                        "Synthetic compound", "Tablet 5 mg", "Synthetic maker", CATEGORY_ID, "Synthetic supplies",
                        "Strip of 10 tablets", "11.50", null, false, false, ProductStatus.INACTIVE)), 0, 20, 1));

        var response = mvc.perform(get("/api/staff/products"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree("""
                {"items":[{"id":"%s","kind":"MEDICINE","name":"Synthetic medicine","brandName":"Synthetic brand",
                "genericName":"Synthetic compound","dosageForm":"Tablet 5 mg","manufacturer":"Synthetic maker",
                "categoryId":"%s","categoryName":"Synthetic supplies","saleUnit":"Strip of 10 tablets",
                "sellingPrice":"11.50","mrp":null,"active":false,"requireValidation":false,"status":"INACTIVE"}],
                "page":0,"size":20,"totalItems":1}
                """.formatted(PRODUCT_ID, CATEGORY_ID)));
    }

    @ParameterizedTest
    @EnumSource(ProductStatus.class)
    void productListPassesEveryStatusAndLiteralSearchFilter(ProductStatus filter) throws Exception {
        when(products.list("Synthetic_%!", CATEGORY_ID, filter, true, 2, 50))
                .thenReturn(new CatalogPage<>(List.of(), 2, 50, 1));

        var response = mvc.perform(get("/api/staff/products").param("q", "Synthetic_%!")
                        .param("categoryId", CATEGORY_ID.toString().toUpperCase(java.util.Locale.ROOT))
                        .param("status", filter.name()).param("reviewRequired", "true")
                        .param("page", "2").param("size", "50").param("inStock", "PRIVATE_QUERY"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree(
                "{\"items\":[],\"page\":2,\"size\":50,\"totalItems\":1}"));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 100})
    void productListAcceptsEmptyOrMaximumLengthSearchAndExplicitFalse(int queryLength) throws Exception {
        String query = "q".repeat(queryLength);
        when(products.list(query, null, null, false, 0, 1))
                .thenReturn(new CatalogPage<>(List.of(), 0, 1, 0));

        mvc.perform(get("/api/staff/products").param("q", query).param("reviewRequired", "false")
                        .param("page", "0").param("size", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.size").value(1));
    }

    @ParameterizedTest(name = "{0}={1}")
    @MethodSource("invalidProductQueries")
    void invalidProductListQueryIsBoundedBeforeServiceCalls(String key, String value) throws Exception {
        invalid(get("/api/staff/products").param(key, value));
    }

    private static Stream<Arguments> invalidProductQueries() {
        List<Arguments> cases = new ArrayList<>();
        invalidCategoryQueries().filter(argument -> !argument.get()[0].equals("includeInactive"))
                .forEach(cases::add);
        for (String value : List.of("", "1", "on", "TRUE", "PRIVATE_QUERY")) {
            cases.add(Arguments.of("reviewRequired", value));
        }
        for (String value : List.of("", "active", "PRIVATE_QUERY")) cases.add(Arguments.of("status", value));
        for (String value : List.of("", "1-1-1-1-1", "PRIVATE_QUERY", " " + CATEGORY_ID,
                CATEGORY_ID + " ", "0b8e3f529c1a4d67a2e47f3b5c9d1e20")) {
            cases.add(Arguments.of("categoryId", value));
        }
        cases.add(Arguments.of("q", "q".repeat(101)));
        return cases.stream();
    }

    @Test
    void productDetailReturnsExactlyThePublicProductProjection() throws Exception {
        when(products.get(PRODUCT_ID)).thenReturn(product(null, null, false, 0));

        var response = mvc.perform(get("/api/staff/products/{id}", PRODUCT_ID))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree(PRODUCT_RESPONSE));
    }

    @Test
    void uppercaseCanonicalProductIdIsAccepted() throws Exception {
        when(products.get(PRODUCT_ID)).thenReturn(product("11.50", "12.00", true, 7));

        mvc.perform(get("/api/staff/products/{id}", PRODUCT_ID.toString().toUpperCase(java.util.Locale.ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(PRODUCT_ID.toString()))
                .andExpect(jsonPath("$.sellingPrice").value("11.50"))
                .andExpect(jsonPath("$.status").value("ACTIVE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"PRIVATE_PATH", "1-1-1-1-1", "6c1d9a0e2b7f4e118d3a5f0e9b2c7a14",
            " 6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14", "6c1d9a0e-2b7f-4e11-8d3a-5f0e9b2c7a14 "})
    void malformedProductDetailIdIsBoundedBeforeServiceCalls(String id) throws Exception {
        invalid(get("/api/staff/products/{id}", id));
    }

    @Test
    void missingProductHasABoundedNotFoundResponse() throws Exception {
        when(products.get(PRODUCT_ID)).thenThrow(new CatalogNotFoundException());

        var response = mvc.perform(get("/api/staff/products/{id}", PRODUCT_ID))
                .andExpect(status().isNotFound())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree("""
                {"code":"NOT_FOUND","message":"The requested resource was not found.","requestId":"%s"}
                """.formatted(response.getHeader("X-Request-ID"))));
    }

    @Test
    void categoryUpdateReturnsExactlyThePublicCategoryProjection() throws Exception {
        when(categories.update(CATEGORY_ID, "Synthetic supplies", false, 2L, ADMIN))
                .thenReturn(new CategoryView(CATEGORY_ID, "Synthetic supplies", false, 4, 3));

        var response = mvc.perform(put("/api/staff/categories/{id}", CATEGORY_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Synthetic supplies\",\"active\":false,\"version\":2}"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree("""
                {"id":"%s","name":"Synthetic supplies","active":false,"productCount":4,"version":3}
                """.formatted(CATEGORY_ID)));
    }

    @ParameterizedTest
    @ValueSource(longs = {0, Long.MAX_VALUE})
    void categoryUpdatePreservesTheEntireAcceptedVersionRange(long version) throws Exception {
        when(categories.update(CATEGORY_ID, "Synthetic supplies", false, version, ADMIN))
                .thenReturn(new CategoryView(CATEGORY_ID, "Synthetic supplies", false, 4, version));

        var response = mvc.perform(put("/api/staff/categories/{id}",
                        CATEGORY_ID.toString().toUpperCase(java.util.Locale.ROOT))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(changed(CATEGORY_UPDATE, "version", Long.toString(version))))
                .andExpect(status().isOk()).andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString()).get("version").longValue()).isEqualTo(version);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidCategoryUpdates")
    void invalidCategoryUpdateIsBoundedBeforeServiceCalls(String description, String body) throws Exception {
        invalid(put("/api/staff/categories/{id}", CATEGORY_ID).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static Stream<Arguments> invalidCategoryUpdates() {
        List<Arguments> cases = new ArrayList<>();
        for (String key : List.of("id", "kind", "sellingPrice", "mrp", "productCount", "updatedBy", "stock", "history")) {
            cases.add(Arguments.of("unknown category-update key " + key, changed(CATEGORY_UPDATE, key, "\"PRIVATE_BODY\"")));
        }
        cases.add(Arguments.of("missing name", removed(CATEGORY_UPDATE, "name")));
        for (String value : List.of("null", "1", "true", "[]", "{}")) {
            cases.add(Arguments.of("name is not a required string " + value, changed(CATEGORY_UPDATE, "name", value)));
        }
        cases.add(Arguments.of("missing active", removed(CATEGORY_UPDATE, "active")));
        for (String value : List.of("null", "1", "\"false\"", "[]", "{}")) {
            cases.add(Arguments.of("active is not a boolean " + value, changed(CATEGORY_UPDATE, "active", value)));
        }
        addInvalidVersions(cases, CATEGORY_UPDATE);
        addInvalidBodies(cases);
        return cases.stream();
    }

    @ParameterizedTest
    @MethodSource("malformedIds")
    void malformedCategoryUpdateIdIsBoundedBeforeServiceCalls(String id) throws Exception {
        invalid(put("/api/staff/categories/{id}", id).contentType(MediaType.APPLICATION_JSON).content(CATEGORY_UPDATE));
    }

    private static Stream<String> malformedIds() {
        return Stream.of("PRIVATE_PATH", "1-1-1-1-1", "6c1d9a0e2b7f4e118d3a5f0e9b2c7a14",
                " " + PRODUCT_ID, PRODUCT_ID + " ");
    }

    private static void addInvalidVersions(List<Arguments> cases, String body) {
        cases.add(Arguments.of("missing version", removed(body, "version")));
        for (String value : List.of("null", "-1", "0.0", "1e0", "\"0\"", "true", "[]", "{}", "9223372036854775808")) {
            cases.add(Arguments.of("version is not a nonnegative JSON long " + value, changed(body, "version", value)));
        }
    }

    private static void addInvalidBodies(List<Arguments> cases) {
        for (String body : List.of("null", "[]", "[{}]", "true", "1", "\"PRIVATE_BODY\"", "", "{\"PRIVATE_BODY\"")) {
            cases.add(Arguments.of("non-object or unreadable JSON " + body, body));
        }
    }

    @Test
    void catalogUpdateReturnsExactlyThePublicProductProjection() throws Exception {
        when(products.updateCatalog(PRODUCT_ID, fields(true), 7L, ADMIN))
                .thenReturn(product("11.50", "12.00", true, 8));

        var response = mvc.perform(put("/api/staff/products/{id}", PRODUCT_ID)
                        .contentType(MediaType.APPLICATION_JSON).content(PRODUCT_UPDATE))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        ObjectNode expected = (ObjectNode) JSON.readTree(PRODUCT_RESPONSE);
        expected.put("sellingPrice", "11.50");
        expected.put("mrp", "12.00");
        expected.put("active", true);
        expected.put("status", "ACTIVE");
        expected.put("version", 8);
        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(expected);
    }

    @ParameterizedTest
    @ValueSource(longs = {0, Long.MAX_VALUE})
    void catalogUpdatePreservesTheEntireAcceptedVersionRange(long version) throws Exception {
        when(products.updateCatalog(PRODUCT_ID, fields(true), version, ADMIN))
                .thenReturn(product("11.50", "12.00", true, version));

        var response = mvc.perform(put("/api/staff/products/{id}",
                        PRODUCT_ID.toString().toUpperCase(java.util.Locale.ROOT))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(changed(PRODUCT_UPDATE, "version", Long.toString(version))))
                .andExpect(status().isOk()).andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString()).get("version").longValue()).isEqualTo(version);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void catalogUpdateAllowsOmittedOrNullNullableFields(boolean explicitNull) throws Exception {
        var submitted = new ProductRules.CatalogFields("Synthetic thermometer", null, null, null, null,
                "1 piece", null, CATEGORY_ID, true, false);
        var equipment = new ProductView(PRODUCT_ID, ProductKind.EQUIPMENT, "Synthetic thermometer", null,
                null, null, null, CATEGORY_ID, "Synthetic supplies", "1 piece", null, null, false,
                true, ProductStatus.NEEDS_PRICE, null, 0, NOW, "catalog.admin", List.of());
        when(products.updateCatalog(PRODUCT_ID, submitted, 0L, ADMIN)).thenReturn(equipment);
        String body = """
                {"name":"Synthetic thermometer","saleUnit":"1 piece","categoryId":"%s",
                "requireValidation":true,"active":false,"version":0}
                """.formatted(CATEGORY_ID);
        if (explicitNull) {
            for (String field : List.of("brandName", "genericName", "manufacturer", "dosageForm", "description")) {
                body = changed(body, field, "null");
            }
        }

        mvc.perform(put("/api/staff/products/{id}", PRODUCT_ID).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kind").value("EQUIPMENT"))
                .andExpect(jsonPath("$.genericName").value(nullValue()))
                .andExpect(jsonPath("$.dosageForm").value(nullValue()))
                .andExpect(jsonPath("$.description").value(nullValue()));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidCatalogUpdates")
    void invalidCatalogUpdateIsBoundedBeforeServiceCalls(String description, String body) throws Exception {
        invalid(put("/api/staff/products/{id}", PRODUCT_ID).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static Stream<Arguments> invalidCatalogUpdates() {
        List<Arguments> cases = new ArrayList<>();
        for (String key : List.of("id", "kind", "sellingPrice", "mrp", "stock", "quantity", "batch", "expiry",
                "updatedBy", "status", "history")) {
            cases.add(Arguments.of("unknown catalog-update key " + key, changed(PRODUCT_UPDATE, key, "\"PRIVATE_BODY\"")));
        }
        for (String field : List.of("name", "saleUnit", "categoryId")) {
            cases.add(Arguments.of("missing " + field, removed(PRODUCT_UPDATE, field)));
            for (String value : List.of("null", "1", "true", "[]", "{}")) {
                cases.add(Arguments.of(field + " is not a required string " + value, changed(PRODUCT_UPDATE, field, value)));
            }
        }
        for (String field : List.of("brandName", "genericName", "manufacturer", "dosageForm", "description")) {
            for (String value : List.of("1", "true", "[]", "{}")) {
                cases.add(Arguments.of(field + " is not a nullable string " + value, changed(PRODUCT_UPDATE, field, value)));
            }
        }
        for (String field : List.of("active", "requireValidation")) {
            cases.add(Arguments.of("missing " + field, removed(PRODUCT_UPDATE, field)));
            for (String value : List.of("null", "1", "\"true\"", "[]", "{}")) {
                cases.add(Arguments.of(field + " is not a boolean " + value, changed(PRODUCT_UPDATE, field, value)));
            }
        }
        for (String id : List.of("", "PRIVATE_BODY", "1-1-1-1-1", " " + CATEGORY_ID,
                CATEGORY_ID + " ", "0b8e3f529c1a4d67a2e47f3b5c9d1e20")) {
            cases.add(Arguments.of("malformed categoryId " + id,
                    changed(PRODUCT_UPDATE, "categoryId", JSON.writeValueAsString(id))));
        }
        addInvalidVersions(cases, PRODUCT_UPDATE);
        addInvalidBodies(cases);
        return cases.stream();
    }

    @ParameterizedTest
    @MethodSource("malformedIds")
    void malformedCatalogUpdateIdIsBoundedBeforeServiceCalls(String id) throws Exception {
        invalid(put("/api/staff/products/{id}", id).contentType(MediaType.APPLICATION_JSON).content(PRODUCT_UPDATE));
    }

    @Test
    void pricingUpdateConvertsExactDecimalStringsAndReturnsThePublicProductProjection() throws Exception {
        when(products.updatePricing(eq(PRODUCT_ID), argThat(money -> money != null && money.toString().equals("11.50")),
                argThat(money -> money != null && money.toString().equals("12.00")), eq(7L), eq(ADMIN)))
                .thenReturn(product("11.50", "12.00", false, 8));

        var response = mvc.perform(put("/api/staff/products/{id}/pricing", PRODUCT_ID)
                        .contentType(MediaType.APPLICATION_JSON).content(PRICING_UPDATE))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        ObjectNode expected = (ObjectNode) JSON.readTree(PRODUCT_RESPONSE);
        expected.put("sellingPrice", "11.50");
        expected.put("mrp", "12.00");
        expected.put("status", "INACTIVE");
        expected.put("version", 8);
        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(expected);
    }

    @ParameterizedTest(name = "selling={0}, mrp={1}")
    @MethodSource("acceptedPricingAmounts")
    void pricingUpdatePreservesExactMoneyAcrossTheAcceptedRange(String price, String mrp,
                                                               String expectedPrice, String expectedMrp) throws Exception {
        when(products.updatePricing(eq(PRODUCT_ID),
                argThat(money -> money != null && money.toString().equals(expectedPrice)),
                argThat(money -> expectedMrp == null ? money == null
                        : money != null && money.toString().equals(expectedMrp)), eq(0L), eq(ADMIN)))
                .thenReturn(product(expectedPrice, expectedMrp, false, 0));
        String body = changed(changed(changed(PRICING_UPDATE, "sellingPrice", JSON.writeValueAsString(price)),
                "mrp", JSON.writeValueAsString(mrp)), "version", "0");

        var response = mvc.perform(put("/api/staff/products/{id}/pricing", PRODUCT_ID)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sellingPrice").value(expectedPrice))
                .andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString()).get("mrp"))
                .isEqualTo(JSON.readTree(JSON.writeValueAsString(expectedMrp)));
    }

    private static Stream<Arguments> acceptedPricingAmounts() {
        return Stream.of(Arguments.of("0.01", null, "0.01", null),
                Arguments.of("9999999.99", "9999999.99", "9999999.99", "9999999.99"),
                Arguments.of("1", null, "1.00", null),
                Arguments.of("0000001", "1.5", "1.00", "1.50"),
                Arguments.of("11.5", "12.00", "11.50", "12.00"));
    }

    @ParameterizedTest
    @ValueSource(longs = {0, Long.MAX_VALUE})
    void pricingUpdateAllowsOmittedMrpAndTheEntireAcceptedVersionRange(long version) throws Exception {
        when(products.updatePricing(eq(PRODUCT_ID), argThat(money -> money != null && money.toString().equals("11.50")),
                argThat(money -> money == null), eq(version), eq(ADMIN)))
                .thenReturn(product("11.50", null, false, version));
        String body = changed(removed(PRICING_UPDATE, "mrp"), "version", Long.toString(version));

        var response = mvc.perform(put("/api/staff/products/{id}/pricing",
                        PRODUCT_ID.toString().toUpperCase(java.util.Locale.ROOT))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mrp").value(nullValue())).andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString()).get("version").longValue()).isEqualTo(version);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidPricingUpdates")
    void invalidPricingUpdateIsBoundedBeforeServiceCalls(String description, String body) throws Exception {
        invalid(put("/api/staff/products/{id}/pricing", PRODUCT_ID).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static Stream<Arguments> invalidPricingUpdates() {
        List<Arguments> cases = new ArrayList<>();
        for (String key : List.of("active", "requireValidation", "name", "kind", "id", "categoryId", "stock", "history", "updatedBy")) {
            cases.add(Arguments.of("unknown pricing key " + key, changed(PRICING_UPDATE, key, "\"PRIVATE_BODY\"")));
        }
        cases.add(Arguments.of("missing sellingPrice", removed(PRICING_UPDATE, "sellingPrice")));
        cases.add(Arguments.of("null sellingPrice", changed(PRICING_UPDATE, "sellingPrice", "null")));
        for (String field : List.of("sellingPrice", "mrp")) {
            for (String value : List.of("11.50", "1", "true", "[]", "{}")) {
                cases.add(Arguments.of(field + " is not a decimal string " + value, changed(PRICING_UPDATE, field, value)));
            }
            for (String amount : List.of("", "0", "0.00", "-1", "+1", "1.005", "1e3", "1,000", " 1.00",
                    "1.00 ", "10000000", "١", "１", ".01", "1.", "NaN", "Infinity")) {
                cases.add(Arguments.of("invalid " + field + " text " + amount,
                        changed(PRICING_UPDATE, field, JSON.writeValueAsString(amount))));
            }
        }
        addInvalidVersions(cases, PRICING_UPDATE);
        addInvalidBodies(cases);
        return cases.stream();
    }

    @ParameterizedTest
    @MethodSource("malformedIds")
    void malformedPricingUpdateIdIsBoundedBeforeServiceCalls(String id) throws Exception {
        invalid(put("/api/staff/products/{id}/pricing", id).contentType(MediaType.APPLICATION_JSON).content(PRICING_UPDATE));
    }

    @ParameterizedTest(name = "{0}: {2}")
    @MethodSource("updateFailures")
    void updateServiceFailuresKeepTheBoundedErrorContract(String route, RuntimeException failure,
                                                          String code, int httpStatus, String message) throws Exception {
        MockHttpServletRequestBuilder request;
        if (route.equals("categories")) {
            when(categories.update(CATEGORY_ID, "Synthetic supplies", false, 2L, ADMIN)).thenThrow(failure);
            request = put("/api/staff/categories/{id}", CATEGORY_ID).content(CATEGORY_UPDATE);
        } else if (route.equals("catalog")) {
            when(products.updateCatalog(PRODUCT_ID, fields(true), 7L, ADMIN)).thenThrow(failure);
            request = put("/api/staff/products/{id}", PRODUCT_ID).content(PRODUCT_UPDATE);
        } else {
            when(products.updatePricing(eq(PRODUCT_ID), any(Money.class), any(Money.class), eq(7L), eq(ADMIN)))
                    .thenThrow(failure);
            request = put("/api/staff/products/{id}/pricing", PRODUCT_ID).content(PRICING_UPDATE);
        }

        var response = mvc.perform(request.contentType(MediaType.APPLICATION_JSON).header("X-Request-ID", "PRIVATE_CALLER_ID"))
                .andExpect(status().is(httpStatus))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();
        String requestId = response.getHeader("X-Request-ID");
        assertThat(requestId).matches("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}");
        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree("""
                {"code":"%s","message":"%s","requestId":"%s"}
                """.formatted(code, message, requestId)));
    }

    private static Stream<Arguments> updateFailures() {
        List<Arguments> cases = new ArrayList<>();
        for (String route : List.of("categories", "catalog", "pricing")) {
            cases.add(Arguments.of(route, new CatalogNotFoundException(), "NOT_FOUND", 404,
                    "The requested resource was not found."));
            cases.add(Arguments.of(route, new StaleUpdateException(), "STALE_UPDATE", 409,
                    "This record changed after you opened it. Reload and try again."));
        }
        cases.add(Arguments.of("categories", new CategoryNameTakenException(), "CATEGORY_NAME_TAKEN", 409,
                "A category with this name already exists."));
        cases.add(Arguments.of("catalog", new PriceRequiredException(), "PRICE_REQUIRED", 409,
                "Add a price before activating this product."));
        for (String route : List.of("catalog", "pricing")) {
            cases.add(Arguments.of(route, new InvalidCatalogException("PRIVATE_DOMAIN"), "INVALID_REQUEST", 400,
                    "The request is invalid."));
        }
        return cases.stream();
    }

    @Test
    void creatingACategoryReturns201AndTheBoundedCategoryView() throws Exception {
        when(categories.create(eq(CATEGORY_ID), eq("Synthetic supplies"), any(CurrentUser.class)))
                .thenReturn(new CatalogCreation<>(new CategoryView(CATEGORY_ID, "Synthetic supplies", true, 0, 0), true));

        mvc.perform(post("/api/staff/categories").contentType(MediaType.APPLICATION_JSON)
                        .content(CATEGORY_CREATE))
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andExpect(jsonPath("$.id").value(CATEGORY_ID.toString()))
                .andExpect(jsonPath("$.name").value("Synthetic supplies"))
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.productCount").value(0))
                .andExpect(jsonPath("$.version").value(0))
                .andExpect(jsonPath("$.createdBy").doesNotExist());
    }

    @Test
    void aCategoryCreateRetryReturns200AndTheStoredCategoryState() throws Exception {
        when(categories.create(CATEGORY_ID, "Synthetic supplies", ADMIN))
                .thenReturn(new CatalogCreation<>(new CategoryView(CATEGORY_ID, "Synthetic supplies", false, 4, 2), false));

        mvc.perform(post("/api/staff/categories").contentType(MediaType.APPLICATION_JSON).content(CATEGORY_CREATE))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.productCount").value(4))
                .andExpect(jsonPath("$.version").value(2));
    }

    @Test
    void creatingAMedicineReturns201AndExactlyThePublicProductProjection() throws Exception {
        when(products.create(PRODUCT_ID, ProductKind.MEDICINE, fields(false), ADMIN))
                .thenReturn(new CatalogCreation<>(product(null, null, false, 0), true));

        var response = mvc.perform(post("/api/staff/products").contentType(MediaType.APPLICATION_JSON)
                        .content(PRODUCT_CREATE))
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();

        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree(PRODUCT_RESPONSE));
    }

    @Test
    void aProductCreateRetryReturns200WithItsCurrentPriceActivationAndVersion() throws Exception {
        when(products.create(PRODUCT_ID, ProductKind.MEDICINE, fields(false), ADMIN))
                .thenReturn(new CatalogCreation<>(product("11.50", "12.00", true, 7), false));

        mvc.perform(post("/api/staff/products").contentType(MediaType.APPLICATION_JSON).content(PRODUCT_CREATE))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.sellingPrice").value("11.50"))
                .andExpect(jsonPath("$.mrp").value("12.00"))
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.version").value(7));
    }

    @Test
    void equipmentCreationAllowsOmittedNullableMedicineAndOptionalTextFields() throws Exception {
        var submitted = new ProductRules.CatalogFields("Synthetic thermometer", null, null, null, null,
                "1 piece", null, CATEGORY_ID, true, false);
        var equipment = new ProductView(PRODUCT_ID, ProductKind.EQUIPMENT, "Synthetic thermometer", null,
                null, null, null, CATEGORY_ID, "Synthetic supplies", "1 piece", null, null, false,
                true, ProductStatus.NEEDS_PRICE, null, 0, NOW, "catalog.admin", List.of());
        when(products.create(PRODUCT_ID, ProductKind.EQUIPMENT, submitted, ADMIN))
                .thenReturn(new CatalogCreation<>(equipment, true));

        mvc.perform(post("/api/staff/products").contentType(MediaType.APPLICATION_JSON).content("""
                        {"id":"%s","kind":"EQUIPMENT","name":"Synthetic thermometer","saleUnit":"1 piece",
                         "categoryId":"%s","requireValidation":true}
                        """.formatted(PRODUCT_ID, CATEGORY_ID)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.kind").value("EQUIPMENT"))
                .andExpect(jsonPath("$.genericName").value(nullValue()))
                .andExpect(jsonPath("$.dosageForm").value(nullValue()))
                .andExpect(jsonPath("$.requireValidation").value(true));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidProductCreates")
    void invalidProductCreateIsBoundedAndNeverReachesAService(String description, String body) throws Exception {
        invalid(post("/api/staff/products").contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static Stream<Arguments> invalidProductCreates() {
        List<Arguments> cases = new ArrayList<>();
        for (String key : List.of("active", "version", "createdBy", "updatedBy", "sellingPrice", "mrp", "stock",
                "quantity", "batch", "expiry", "status")) {
            cases.add(Arguments.of("unknown product-create key " + key, changed(PRODUCT_CREATE, key, "\"PRIVATE_BODY\"")));
        }
        cases.add(Arguments.of("active false is still forbidden on create", changed(PRODUCT_CREATE, "active", "false")));
        for (String field : List.of("id", "kind", "name", "categoryId", "saleUnit", "genericName", "dosageForm")) {
            cases.add(Arguments.of("missing medicine " + field, removed(PRODUCT_CREATE, field)));
            for (String value : List.of("null", "1", "true", "[]", "{}")) {
                cases.add(Arguments.of(field + " has wrong JSON type " + value, changed(PRODUCT_CREATE, field, value)));
            }
        }
        for (String field : List.of("brandName", "manufacturer", "description")) {
            for (String value : List.of("1", "true", "[]", "{}")) {
                cases.add(Arguments.of("optional " + field + " has wrong JSON type " + value,
                        changed(PRODUCT_CREATE, field, value)));
            }
        }
        cases.add(Arguments.of("missing requireValidation", removed(PRODUCT_CREATE, "requireValidation")));
        for (String value : List.of("null", "1", "\"true\"", "[]", "{}")) {
            cases.add(Arguments.of("requireValidation is not a boolean " + value,
                    changed(PRODUCT_CREATE, "requireValidation", value)));
        }
        for (String field : List.of("id", "categoryId")) {
            for (String id : List.of("", "PRIVATE_BODY", "1-1-1-1-1", " " + CATEGORY_ID, CATEGORY_ID + " ")) {
                cases.add(Arguments.of("malformed " + field + " " + id,
                        changed(PRODUCT_CREATE, field, JSON.writeValueAsString(id))));
            }
        }
        for (String kind : List.of("medicine", "UNKNOWN")) {
            cases.add(Arguments.of("unsupported kind " + kind, changed(PRODUCT_CREATE, "kind", JSON.writeValueAsString(kind))));
        }
        for (String body : List.of("null", "[]", "[{}]", "true", "1", "\"PRIVATE_BODY\"", "", "{\"PRIVATE_BODY\"")) {
            cases.add(Arguments.of("product non-object or unreadable JSON " + body, body));
        }
        return cases.stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidCategoryCreates")
    void invalidCategoryCreateIsBoundedAndNeverReachesAService(String description, String body) throws Exception {
        invalid(post("/api/staff/categories").contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private static Stream<Arguments> invalidCategoryCreates() {
        List<Arguments> cases = new ArrayList<>();
        for (String key : List.of("active", "version", "createdBy", "sellingPrice", "mrp", "stock", "categoryId")) {
            cases.add(Arguments.of("unknown create key " + key, changed(CATEGORY_CREATE, key, "\"PRIVATE_BODY\"")));
        }
        for (String field : List.of("id", "name")) {
            cases.add(Arguments.of("missing " + field, removed(CATEGORY_CREATE, field)));
            for (String value : List.of("null", "1", "true", "[]", "{}")) {
                cases.add(Arguments.of(field + " has wrong JSON type " + value, changed(CATEGORY_CREATE, field, value)));
            }
        }
        for (String id : List.of("", "PRIVATE_BODY", "1-1-1-1-1", " " + CATEGORY_ID, CATEGORY_ID + " ",
                "0b8e3f529c1a4d67a2e47f3b5c9d1e20")) {
            cases.add(Arguments.of("malformed UUID " + id, changed(CATEGORY_CREATE, "id", JSON.writeValueAsString(id))));
        }
        for (String body : List.of("null", "[]", "[{}]", "true", "1", "\"PRIVATE_BODY\"", "", "{\"PRIVATE_BODY\"")) {
            cases.add(Arguments.of("non-object or unreadable JSON " + body, body));
        }
        return cases.stream();
    }

    private void invalid(MockHttpServletRequestBuilder request) throws Exception {
        var response = mvc.perform(request.header("X-Request-ID", "PRIVATE_CALLER_ID"))
                .andExpect(status().isBadRequest())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists("X-Request-ID"))
                .andReturn().getResponse();
        String requestId = response.getHeader("X-Request-ID");
        assertThat(requestId).matches("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}");
        assertThat(JSON.readTree(response.getContentAsString())).isEqualTo(JSON.readTree("""
                {"code":"INVALID_REQUEST","message":"The request is invalid.","requestId":"%s"}
                """.formatted(requestId)));
        verifyNoInteractions(categories, products);
    }

    private static String changed(String body, String field, String value) {
        ObjectNode object = (ObjectNode) JSON.readTree(body);
        object.set(field, JSON.readTree(value));
        return JSON.writeValueAsString(object);
    }

    private static String removed(String body, String field) {
        ObjectNode object = (ObjectNode) JSON.readTree(body);
        object.remove(field);
        return JSON.writeValueAsString(object);
    }

    private static ProductRules.CatalogFields fields(boolean active) {
        return new ProductRules.CatalogFields("Synthetic medicine", "Synthetic brand", "Synthetic compound",
                "Synthetic maker", "Tablet 5 mg", "Strip of 10 tablets", "Synthetic description", CATEGORY_ID, false, active);
    }

    private static ProductView product(String sellingPrice, String mrp, boolean active, long version) {
        return new ProductView(PRODUCT_ID, ProductKind.MEDICINE, "Synthetic medicine", "Synthetic brand",
                "Synthetic compound", "Tablet 5 mg", "Synthetic maker", CATEGORY_ID, "Synthetic supplies",
                "Strip of 10 tablets", sellingPrice, mrp, active, false,
                active ? ProductStatus.ACTIVE : sellingPrice == null ? ProductStatus.NEEDS_PRICE : ProductStatus.INACTIVE,
                "Synthetic description", version, NOW, "catalog.admin", List.of(new ProductHistory(NOW,
                "catalog.admin", ProductChangeType.CREATED, null, null, null, null, null, false)));
    }
}
