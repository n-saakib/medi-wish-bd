package bd.mediwish.web;

import bd.mediwish.address.*;
import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.user.*;
import org.junit.jupiter.api.*;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AddressBookControllerTest {
    private final UUID owner = UUID.randomUUID();
    private final UUID id = UUID.fromString("4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a11");
    private final AddressBookService books = mock(AddressBookService.class);
    private final AddressFields fields = new AddressFields(null, "Demo Recipient", "01700000000", "House 1", "Dhaka");
    private final String create = """
            {"id":"4c1f6f1e-6f3c-4a9e-9d62-0b8f7f3b2a11","label":null,"recipientName":"Demo Recipient",
             "mobile":"01700000000","addressLine":"House 1","city":"Dhaka","isDefault":false}
            """;
    private MockMvc mvc;
    @BeforeEach void start() {
        var principal = new CurrentUser(owner, UUID.randomUUID(), new UserProfile("synthetic", "01700000000", null, false),
                Set.of(UserRole.CUSTOMER), MfaStatus.NOT_REQUIRED, Set.of("ROLE_CUSTOMER"));
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of()));
        mvc = MockMvcBuilders.standaloneSetup(new AddressBookController(books))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .setControllerAdvice(new ApiExceptionHandler(WebTestFixtures.apiErrors()), new ProfileRequestAdvice(WebTestFixtures.apiErrors()))
                .addFilters(new RequestCorrelationFilter()).build();
    }
    @AfterEach void stop() { SecurityContextHolder.clearContext(); }
    @Test void returnsExactBookKeysAndCreateStatusAndOwnerIdentity() throws Exception {
        var view = new AddressBookView("ACTIVE", 3, new AddressRules.ChangeAllowance(5, 10, 4, 9), List.of(
                new AddressBookView.Item(id, null, fields.recipientName(), fields.mobile(), fields.addressLine(), fields.city(), true, 0)));
        when(books.create(owner, id, fields, false)).thenReturn(new AddressBookService.AddressBookCreation(view, true));
        var response = mvc.perform(post("/api/user/me/addresses").contentType(MediaType.APPLICATION_JSON).content(create))
                .andExpect(status().isCreated()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.items[0].isDefault").value(true)).andReturn();
        var json = tools.jackson.databind.json.JsonMapper.builder().build().readTree(response.getResponse().getContentAsString());
        assertThat(Set.copyOf(json.propertyNames())).containsExactlyInAnyOrder("accountState", "limit", "changeAllowance", "items");
        assertThat(Set.copyOf(json.get("items").get(0).propertyNames())).containsExactlyInAnyOrder("id", "label", "recipientName", "mobile", "addressLine", "city", "isDefault", "version");
        when(books.create(owner, id, fields, false)).thenReturn(new AddressBookService.AddressBookCreation(view, false));
        mvc.perform(post("/api/user/me/addresses").contentType(MediaType.APPLICATION_JSON).content(create)).andExpect(status().isOk());
        verify(books, times(2)).create(owner, id, fields, false);
    }
    @Test void rejectsMissingUnknownWrongTypesAndNonCanonicalIdsBeforeService() throws Exception {
        for (String body : new String[]{"{}", "[]", "null", "{", create.replace("\"label\":null,", ""),
                create.replace("\"label\":null", "\"label\":12"), create.replace("\"isDefault\":false", "\"isDefault\":null"),
                create.replace("\"isDefault\":false", "\"isDefault\":0"), create.replace("\"isDefault\":false", "\"isDefault\":\"false\""),
                create.replace("\"isDefault\":false", "\"isDefault\":false,\"private\":true"),
                create.replace(id.toString(), "1-1-1-1-1"), create.replace(id.toString(), id.toString().toUpperCase(Locale.ROOT))}) {
            mvc.perform(post("/api/user/me/addresses").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                    .andExpect(jsonPath("$.requestId").isNotEmpty());
        }
        verifyNoInteractions(books);
    }
    @Test void validatesEditAndDeleteVersionsAndNonJsonBodiesBeforeService() throws Exception {
        String edit = create.replace("\"id\":\"" + id + "\",", "").replace("\"isDefault\":false", "\"isDefault\":false,\"version\":0");
        for (String bad : new String[]{"null", "-1", "1.5", "\"0\"", "true", "9223372036854775808"}) {
            mvc.perform(put("/api/user/me/addresses/" + id).contentType(MediaType.APPLICATION_JSON).content(edit.replace("\"version\":0", "\"version\":" + bad)))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        for (String bad : new String[]{"", "-1", "+1", "1.5", "9223372036854775808", "1e2"}) {
            mvc.perform(delete("/api/user/me/addresses/" + id).param("version", bad))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        mvc.perform(delete("/api/user/me/addresses/" + id)).andExpect(status().isBadRequest());
        mvc.perform(post("/api/user/me/addresses").contentType(MediaType.TEXT_PLAIN).content("PRIVATE_BODY"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        verifyNoInteractions(books);
        mvc.perform(put("/api/user/me/addresses/" + id).contentType(MediaType.APPLICATION_JSON).content(edit)).andExpect(status().isOk());
        verify(books).update(owner, id, fields, false, 0);
        mvc.perform(delete("/api/user/me/addresses/" + id).param("version", "0")).andExpect(status().isOk());
        verify(books).delete(owner, id, 0);
    }
}
