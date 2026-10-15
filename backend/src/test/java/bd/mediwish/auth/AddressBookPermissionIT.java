package bd.mediwish.auth;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.*;
import java.util.*;
import static bd.mediwish.testsupport.ApiAssertions.*;
import static bd.mediwish.auth.AddressBookIT.*;
import static org.assertj.core.api.Assertions.*;

@Tag("integration") @Tag("security") @TestInstance(TestInstance.Lifecycle.PER_CLASS)
@ExtendWith(OutputCaptureExtension.class)
class AddressBookPermissionIT {
    private final AuthApi api=AuthApi.start();
    @AfterAll void close() throws Exception { api.close(); }
    @AfterEach void privacy(CapturedOutput output) { api.assertLogsOmitSecrets(output); }
    @ParameterizedTest @ValueSource(strings={"missing","malformed","revoked"})
    void everyAddressRouteRejectsInvalidAuthenticationWithoutChangingRows(String authentication) throws Exception {
        var user=api.registered(); var session=api.signIn(user);
        UUID id=UUID.randomUUID(); assertThat(api.postAddress(session.accessToken(),AuthApi.addressBody(id,api.newAddress(),false)).statusCode()).isEqualTo(201);
        Map<String,String> headers=switch(authentication){
            case "missing" -> Map.of(); case "malformed" -> Map.of("Authorization","Bearer "+api.track("malformed-address-token"));
            default -> { assertThat(api.logout(session.refreshToken()).statusCode()).isEqualTo(204); yield Map.of("Authorization","Bearer "+session.accessToken()); }
        };
        denied(user,id,headers,401,"AUTHENTICATION_REQUIRED");
    }
    @ParameterizedTest @ValueSource(strings={"ADMIN","MODERATOR"})
    void staffCannotUseAnyAddressRouteUntilMfaIsVerified(String role) throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=UUID.randomUUID();
        assertThat(api.postAddress(token,AuthApi.addressBody(id,api.newAddress(),false)).statusCode()).isEqualTo(201);
        soleRole(user,role); String restricted=api.session(api.login(user.username(),user.password()),"ENROLLMENT_REQUIRED").accessToken();
        denied(user,id,Map.of("Authorization","Bearer "+restricted),403,"MFA_REQUIRED");
        api.enroll(user); restricted=api.session(api.login(user.username(),user.password()),"VERIFICATION_REQUIRED").accessToken();
        denied(user,id,Map.of("Authorization","Bearer "+restricted),403,"MFA_REQUIRED");
    }
    @ParameterizedTest @ValueSource(strings={"CUSTOMER","DELIVERY_PERSON","ADMIN","MODERATOR"})
    void everySoleRoleUsesOnlyItsOwnBook(String role) throws Exception {
        var user=api.registered(); soleRole(user,role);
        String token=role.equals("ADMIN")||role.equals("MODERATOR")?api.enroll(user).session().accessToken():api.signIn(user).accessToken();
        var other=api.registered(); String otherToken=api.signIn(other).accessToken(); UUID otherId=UUID.randomUUID();
        assertThat(api.postAddress(otherToken,AuthApi.addressBody(otherId,api.newAddress(),false)).statusCode()).isEqualTo(201); String before=fingerprint(api,other);
        UUID id=UUID.randomUUID(); assertThat(api.postAddress(token,AuthApi.addressBody(id,api.newAddress(),false)).statusCode()).isEqualTo(201);
        assertThat(items(api.addresses(token))).hasSize(1);
        var current=item(api.addresses(token),id); var saved=api.putAddress(token,id,edit(current,api.newAddress(),true)); assertThat(saved.statusCode()).isEqualTo(200);
        assertError(api.putAddress(token,otherId,AuthApi.addressEdit(api.newAddress(),true,0)),404,"NOT_FOUND"); assertError(api.deleteAddress(token,otherId,0),404,"NOT_FOUND");
        assertThat(api.deleteAddress(token,id,version(item(saved,id))).statusCode()).isEqualTo(200);
        assertThat(fingerprint(api,other)).isEqualTo(before); assertThat(items(api.addresses(token))).isEmpty();
    }
    private void soleRole(AuthApi.User user,String role) throws Exception {
        if(!role.equals("CUSTOMER")){api.removeRole(user,"CUSTOMER");api.grantRole(user,role);}
        assertThat(api.database().query("SELECT role FROM user_roles WHERE user_id=?",r -> r.getString(1),api.userId(user))).containsExactly(role);
    }
    private void denied(AuthApi.User user,UUID id,Map<String,String> authentication,int status,String code) throws Exception {
        String before=fingerprint(api,user); long changes=api.changeRows(user); var headers=new HashMap<>(authentication); headers.put("Content-Type","application/json");
        for(String method:List.of("GET","POST","PUT","DELETE")) {
            String path="/api/user/me/addresses"+(method.equals("PUT")||method.equals("DELETE")?"/"+id:"");
            if(method.equals("DELETE")) path += "?version=0";
            String body=switch(method){case "POST" -> AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false);case "PUT" -> AuthApi.addressEdit(api.newAddress(),true,0);case "DELETE" -> null;default -> null;};
            assertError(api.send(method,path,headers,body),status,code); assertThat(fingerprint(api,user)).isEqualTo(before); assertThat(api.changeRows(user)).isEqualTo(changes);
        }
    }
}
