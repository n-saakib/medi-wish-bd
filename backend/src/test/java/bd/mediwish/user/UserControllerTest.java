package bd.mediwish.user;

import bd.mediwish.web.ApiErrors;
import bd.mediwish.web.RequestCorrelationFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class UserControllerTest {
    @Mock UserService service;
    @Mock UserRepository users;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        var messages = new ResourceBundleMessageSource();
        messages.setBasename("messages");
        var errors = new ApiErrors(messages, JsonMapper.builder().build());
        mvc = MockMvcBuilders.standaloneSetup(new UserController(service, users, errors))
                .addFilters(new RequestCorrelationFilter()).build();
    }

    @Test
    void registrationReturnsOnlyPublicUserData() throws Exception {
        when(service.register("alice_1", "01700000000", "alice@example.com", "a-very-long-password"))
                .thenReturn(new User("alice_1", "01700000000", "alice@example.com", "encoded-verifier"));

        mvc.perform(post("/api/auth/register")
                        .header("X-Request-ID", "register-01")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"alice_1","mobile":"01700000000","email":"alice@example.com","password":"a-very-long-password"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username").value("alice_1"))
                .andExpect(jsonPath("$.mobile").value("01700000000"))
                .andExpect(jsonPath("$.email").value("alice@example.com"))
                .andExpect(jsonPath("$.mobileVerificationDeferred").value(true))
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist());
    }

    @Test
    void malformedRegistrationUsesBoundedErrorContract() throws Exception {
        mvc.perform(post("/api/auth/register")
                        .header("X-Request-ID", "register-02")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("not-json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.message").value("The request is invalid."))
                .andExpect(jsonPath("$.requestId").value("register-02"));
    }

    @Test
    void duplicateRegistrationUsesExternalizedBoundedError() throws Exception {
        when(service.register(any(), any(), any(), any())).thenThrow(new UserService.DuplicateUserException());

        mvc.perform(post("/api/auth/register")
                        .header("X-Request-ID", "register-03")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"alice_1","mobile":"01700000000","password":"a-very-long-password"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DUPLICATE_USER"))
                .andExpect(jsonPath("$.message").value("The username or mobile number is already in use."))
                .andExpect(jsonPath("$.requestId").value("register-03"));
    }
}
