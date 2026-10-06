package bd.mediwish.web;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.user.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Strict profile wire types and owner identity through the actual MVC adapter. */
class ProfileControllerTest {
    private final UUID owner = UUID.randomUUID();
    private final ProfileService profiles = mock(ProfileService.class);
    private final MobileChangeService changes = mock(MobileChangeService.class);
    private MockMvc mvc;

    @BeforeEach
    void start() {
        var principal = new CurrentUser(owner, UUID.randomUUID(),
                new UserProfile("demo.user", "01700000000", null, false),
                Set.of(UserRole.CUSTOMER), MfaStatus.NOT_REQUIRED, Set.of("ROLE_CUSTOMER"));
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(principal, null, java.util.List.of()));
        mvc = MockMvcBuilders.standaloneSetup(new ProfileController(profiles, changes))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .setControllerAdvice(new ApiExceptionHandler(WebTestFixtures.apiErrors()),
                        new ProfileRequestAdvice(WebTestFixtures.apiErrors()))
                .addFilters(new RequestCorrelationFilter()).build();
    }

    @AfterEach
    void close() {
        SecurityContextHolder.clearContext();
        verify(changes, never()).activate(any(), any());
    }

    @Test
    void acceptsOnlyTheFourTypedEditFieldsAndUsesTheCaller() throws Exception {
        mvc.perform(put("/api/user/me/profile").contentType(MediaType.APPLICATION_JSON).content(
                "{\"fullName\":\"Demo Name\",\"email\":null,\"dateOfBirth\":\"1990-05-01\",\"version\":0}"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
        var edit = ArgumentCaptor.forClass(ProfileEdit.class);
        verify(profiles).update(eq(owner), edit.capture());
        assertThat(edit.getValue()).isEqualTo(new ProfileEdit("Demo Name", null, LocalDate.of(1990, 5, 1), 0L));
    }

    @Test
    void rejectsMissingUnknownAndCoercedFieldsBeforeAnyTransaction() throws Exception {
        String valid = "{\"fullName\":null,\"email\":null,\"dateOfBirth\":null,\"version\":0}";
        for (String body : new String[]{"{}", "[]", "null", "{",
                valid.replace("\"version\":0", "\"version\":null"),
                valid.replace("\"version\":0", "\"version\":1.5"),
                valid.replace("\"version\":0", "\"version\":\"0\""),
                valid.replace("\"version\":0", "\"version\":true"),
                valid.replace("\"version\":0", "\"version\":-1"),
                valid.replace("\"version\":0", "\"version\":9223372036854775808"),
                valid.replace("\"fullName\":null", "\"fullName\":1"),
                valid.replace("\"email\":null", "\"email\":false"),
                valid.replace("\"dateOfBirth\":null", "\"dateOfBirth\":\"1990-02-30\""),
                valid.replace("\"dateOfBirth\":null", "\"dateOfBirth\":\"1990-5-1\""),
                valid.replace("\"dateOfBirth\":null", "\"dateOfBirth\":19900501"),
                valid.replace("\"version\":0", "\"version\":0,\"username\":\"another\"")}) {
            mvc.perform(put("/api/user/me/profile").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.requestId").isNotEmpty());
        }
        verifyNoInteractions(profiles, changes);
    }

    @Test
    void stageRequiresOneStringAndCancelHasNoBody() throws Exception {
        for (String body : new String[]{"{}", "[]", "{\"mobile\":null}", "{\"mobile\":1}",
                "{\"mobile\":true}", "{\"mobile\":\"01800000000\",\"verified\":true}"}) {
            mvc.perform(post("/api/user/me/mobile-change").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        verifyNoInteractions(changes);
        mvc.perform(post("/api/user/me/mobile-change").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mobile\":\"01800000000\"}")).andExpect(status().isAccepted());
        verify(changes).stage(owner, "01800000000");
        mvc.perform(delete("/api/user/me/mobile-change")).andExpect(status().isNoContent())
                .andExpect(content().string("")).andExpect(header().string("Cache-Control", "no-store"));
        verify(changes).cancel(owner);
    }

    @Test
    void nonJsonBodiesAreBounded400ErrorsOnTheProfileContract() throws Exception {
        for (var request : new org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder[]{
                put("/api/user/me/profile"), post("/api/user/me/mobile-change")}) {
            mvc.perform(request.contentType(MediaType.TEXT_PLAIN).content("{}"))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        verifyNoInteractions(profiles, changes);
    }
}
