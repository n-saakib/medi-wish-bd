package bd.mediwish.web;

import bd.mediwish.auth.AuthenticationFailedException;
import bd.mediwish.auth.AuthenticationRequiredException;
import bd.mediwish.auth.InvalidRequestException;
import bd.mediwish.auth.MfaCodeInvalidException;
import bd.mediwish.auth.MfaEnrollmentStaleException;
import bd.mediwish.auth.TooManyAttemptsException;
import bd.mediwish.auth.RoleChangeRefusedException;
import bd.mediwish.auth.UserNotFoundException;
import bd.mediwish.user.UserService;
import bd.mediwish.catalog.*;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import java.sql.SQLException;
import bd.mediwish.user.InvalidProfileException;
import bd.mediwish.user.AccountClosingException;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.function.Supplier;

import static bd.mediwish.testsupport.TestApplication.UUID_PATTERN;
import static bd.mediwish.web.WebTestFixtures.apiErrors;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ApiExceptionHandlerTest {
    private static final Map<String, Supplier<RuntimeException>> FAILURES = Map.ofEntries(
            Map.entry("invalid-catalog", () -> new InvalidCatalogException("PRIVATE_FIELD")),
            Map.entry("invalid-money", InvalidMoneyException::new),
            Map.entry("catalog-access", CatalogAccessDeniedException::new),
            Map.entry("catalog-not-found", CatalogNotFoundException::new),
            Map.entry("stale-update", StaleUpdateException::new),
            Map.entry("price-required", PriceRequiredException::new),
            Map.entry("category-name-taken", CategoryNameTakenException::new),
            Map.entry("id-conflict", IdConflictException::new),
            Map.entry("category-unique", () -> unique("uk_product_categories_name", "23505")),
            Map.entry("other-unique", () -> unique("other_constraint", "23505")),
            Map.entry("other-category-failure", () -> unique("uk_product_categories_name", "23514")),
            Map.entry("mfa-code-invalid", MfaCodeInvalidException::new),
            Map.entry("mfa-enrollment-stale", MfaEnrollmentStaleException::new),
            Map.entry("too-many-attempts", TooManyAttemptsException::new),
            Map.entry("invalid-request", InvalidRequestException::new),
            Map.entry("role-refused", RoleChangeRefusedException::new),
            Map.entry("user-not-found", UserNotFoundException::new),
            Map.entry("invalid-registration", UserService.InvalidRegistrationException::new),
            Map.entry("duplicate-user", UserService.DuplicateUserException::new),
            Map.entry("invalid-profile", () -> new InvalidProfileException("PRIVATE_ROW")),
            Map.entry("account-closing", AccountClosingException::new),
            Map.entry("authentication-failed", AuthenticationFailedException::new),
            Map.entry("authentication-required", AuthenticationRequiredException::new),
            Map.entry("data-access", () -> new DataAccessResourceFailureException("PRIVATE_ROW")),
            Map.entry("transaction", () -> new TransactionSystemException("PRIVATE_ROW")));

    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new FailingController())
            .setControllerAdvice(new ApiExceptionHandler(apiErrors()))
            .addFilters(new RequestCorrelationFilter())
            .build();

    @ParameterizedTest
    @CsvSource({"invalid-request,400,INVALID_REQUEST", "invalid-registration,400,INVALID_REQUEST",
            "duplicate-user,409,DUPLICATE_USER", "invalid-profile,400,INVALID_REQUEST",
            "account-closing,409,ACCOUNT_CLOSING", "authentication-failed,401,AUTHENTICATION_FAILED",
            "authentication-required,401,AUTHENTICATION_REQUIRED", "data-access,500,INTERNAL_ERROR",
            "transaction,500,INTERNAL_ERROR", "mfa-code-invalid,400,MFA_CODE_INVALID",
            "mfa-enrollment-stale,409,MFA_ENROLLMENT_STALE", "too-many-attempts,429,TOO_MANY_ATTEMPTS",
            "invalid-catalog,400,INVALID_REQUEST", "invalid-money,400,INVALID_REQUEST",
            "catalog-access,403,ACCESS_DENIED", "catalog-not-found,404,NOT_FOUND",
            "stale-update,409,STALE_UPDATE", "price-required,409,PRICE_REQUIRED",
            "category-name-taken,409,CATEGORY_NAME_TAKEN", "id-conflict,409,ID_CONFLICT",
            "category-unique,409,CATEGORY_NAME_TAKEN", "other-unique,500,INTERNAL_ERROR",
            "other-category-failure,500,INTERNAL_ERROR", "role-refused,409,ROLE_CHANGE_REFUSED",
            "user-not-found,404,NOT_FOUND"})
    void mapsEachDomainFailureToItsBoundedError(String failure, int status, String code) throws Exception {
        mvc.perform(post("/fail/" + failure).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().is(status))
                .andExpect(jsonPath("$.code").value(code))
                .andExpect(jsonPath("$.requestId", matchesPattern(UUID_PATTERN)))
                .andExpect(content().string(not(containsString("PRIVATE_ROW"))));
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {"{\"PRIVATE_BODY\"", "''", "[1,2]"})
    void unreadableJsonIsAnInvalidRequestThatDoesNotEchoTheBody(String body) throws Exception {
        mvc.perform(post("/fail/unreachable").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(content().string(not(containsString("PRIVATE_BODY"))));
    }

    @ParameterizedTest
    @CsvSource({"fail,415", "api/admin/users,400"})
    void unsupportedMediaKeepsExistingRoutesStableAndBoundsAdministrativeCommands(String path, int status) throws Exception {
        mvc.perform(post("/" + path + "/unreachable").contentType(MediaType.TEXT_PLAIN).content("PRIVATE_BODY"))
                .andExpect(status().is(status)).andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.requestId", matchesPattern(UUID_PATTERN)))
                .andExpect(content().string(not(containsString("PRIVATE_BODY"))));
    }

    @ParameterizedTest
    @CsvSource({"POST,true,max,IMAGE_INVALID", "PUT,true,max,INVALID_REQUEST", "POST,false,max,INVALID_REQUEST", "POST,true,multipart,INVALID_REQUEST"})
    void multipartFailuresUseImageMessageOnlyForAnExactUploadRoute(String method, boolean uuid, String failure, String code) throws Exception {
        String id = uuid ? "8a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b" : "not-uuid";
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request(
                        org.springframework.http.HttpMethod.valueOf(method), "/api/staff/products/" + id + "/images")
                        .param("failure", failure)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(code));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/user/me/profile")
                        .param("failure", failure)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
    @ParameterizedTest
    @CsvSource({"invalid,400,IMAGE_INVALID", "limit,409,IMAGE_LIMIT_REACHED", "storage,503,STORAGE_UNAVAILABLE", "order,409,STALE_UPDATE"})
    void imageDomainFailuresRemainBounded(String failure, int expected, String code) throws Exception {
        mvc.perform(post("/api/staff/products/8a6e5b1c-2f3d-4e5f-8a9b-0c1d2e3f4a5b/images").param("failure", failure))
                .andExpect(status().is(expected)).andExpect(jsonPath("$.code").value(code));
    }

    private static DataIntegrityViolationException unique(String constraint, String sqlState) {
        return new DataIntegrityViolationException("PRIVATE_ROW", new ConstraintViolationException(
                "PRIVATE_ROW", new SQLException("PRIVATE_ROW", sqlState), constraint));
    }

    @RestController
    static class FailingController {
        @org.springframework.web.bind.annotation.RequestMapping({"/api/staff/products/{id}/images", "/api/user/me/profile"})
        void imageFailure(@org.springframework.web.bind.annotation.RequestParam String failure) {
            throw switch (failure) {
                case "max" -> new org.springframework.web.multipart.MaxUploadSizeExceededException(3145728);
                case "multipart" -> new org.springframework.web.multipart.MultipartException("PRIVATE_BODY");
                case "invalid" -> new InvalidImageException();
                case "limit" -> new ImageLimitReachedException();
                case "storage" -> new bd.mediwish.storage.StorageUnavailableException();
                case "order" -> unique("uk_product_images_order", "23505");
                default -> new IllegalArgumentException();
            };
        }
        @PostMapping(value = {"/fail/{failure}", "/api/admin/users/{failure}"}, consumes = MediaType.APPLICATION_JSON_VALUE)
        void fail(@PathVariable String failure, @RequestBody Map<String, String> body) {
            throw FAILURES.get(failure).get();
        }
    }
}
