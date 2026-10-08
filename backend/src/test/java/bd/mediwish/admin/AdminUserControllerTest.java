package bd.mediwish.admin;

import bd.mediwish.auth.InvalidRequestException;
import bd.mediwish.auth.RoleAssignmentService;
import bd.mediwish.user.UserRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

@ExtendWith(MockitoExtension.class)
class AdminUserControllerTest {
    @Mock RoleAssignmentService roles;
    private final JsonMapper json = JsonMapper.builder().build();
    private static final String ID = "3f6b2d1e-8a4c-4b7e-9d2f-0a1b2c3d4e5f";

    @Test
    void aRoleCommandRejectsUnknownFieldsAndCoercedVersionsBeforeCallingTheService() {
        var controller = new AdminUserController(roles);
        for (String body : new String[]{
                "{\"role\":\"MODERATOR\",\"rolesVersion\":0,\"staffRoles\":[\"ADMIN\"]}",
                "{\"role\":\"MODERATOR\",\"rolesVersion\":\"0\"}",
                "{\"role\":\"MODERATOR\",\"rolesVersion\":1.5}",
                "{\"role\":\"MODERATOR\",\"rolesVersion\":null}",
                "{\"role\":\"MODERATOR\",\"rolesVersion\":-1}",
                "{\"role\":\"MODERATOR\",\"rolesVersion\":9223372036854775808}",
                "{\"role\":\"SUPER_ADMIN\",\"rolesVersion\":0}",
                "{\"role\":\"moderator\",\"rolesVersion\":0}",
                "{\"role\":[],\"rolesVersion\":0}",
                "{\"role\":null,\"rolesVersion\":0}",
                "{\"role\":\"\",\"rolesVersion\":0}",
                "{\"role\":\"MODERATOR\"}", "[]", "null"}) {
            assertThatThrownBy(() -> controller.changeRole(null, ID, json.readTree(body)))
                    .isInstanceOf(InvalidRequestException.class);
        }
        verifyNoInteractions(roles);
    }

    @Test
    void searchRejectsUnknownPropertiesInvalidTypesAndOutOfRangeFilters() {
        var controller = new AdminUserController(roles);
        for (String body : new String[]{"[]", "\"term\"", "null", "{\"username\":\"\"}",
                "{\"username\":\"  \"}", "{\"username\":null}", "{\"username\":12}",
                "{\"username\":\"" + "a".repeat(51) + "\"}", "{\"role\":\"admin\"}",
                "{\"role\":null}", "{\"other\":true}", "{\"page\":-1}", "{\"page\":\"0\"}",
                "{\"page\":2147483648}", "{\"size\":0}", "{\"size\":51}", "{\"size\":1.5}"}) {
            assertThatThrownBy(() -> controller.search(json.readTree(body))).isInstanceOf(InvalidRequestException.class);
        }
        verifyNoInteractions(roles);
    }

    @Test
    void searchUsesBoundedDefaultsAndNormalizesThePrefixInItsBody() {
        var controller = new AdminUserController(roles);
        controller.search(json.readTree("{}"));
        controller.search(json.readTree("{\"username\":\"  DEMO._  \",\"role\":\"CUSTOMER\",\"page\":1,\"size\":50}"));
        verify(roles).search(null, null, 0, 20);
        verify(roles).search("demo._", UserRole.CUSTOMER, 1, 50);
    }

    @Test
    void aValidCommandDelegatesTheSingleRoleAndExactVersion() {
        var controller = new AdminUserController(roles);
        controller.changeRole(null, ID, json.readTree("{\"role\":\"DELIVERY_PERSON\",\"rolesVersion\":9223372036854775807}"));
        verify(roles).changeRole(null, java.util.UUID.fromString(ID), UserRole.DELIVERY_PERSON, Long.MAX_VALUE);
    }

    @Test
    void shortenedOrMalformedIdsAreRefusedBeforeTheService() {
        var controller = new AdminUserController(roles);
        for (String id : new String[]{"not-a-uuid", "1-1-1-1-1", ""}) {
            assertThatThrownBy(() -> controller.detail(null, id)).isInstanceOf(InvalidRequestException.class);
        }
        verifyNoInteractions(roles);
    }
}
