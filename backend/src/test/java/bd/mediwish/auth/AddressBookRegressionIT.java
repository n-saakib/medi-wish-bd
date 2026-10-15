package bd.mediwish.auth;
import org.junit.jupiter.api.*;
import java.util.*;
import static bd.mediwish.testsupport.ApiAssertions.*;
import static bd.mediwish.auth.AddressBookIT.*;
import static org.assertj.core.api.Assertions.*;

@Tag("integration") @Tag("regression") @TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AddressBookRegressionIT {
    private final AuthApi api=AuthApi.start();
    @AfterAll void close() throws Exception { api.close(); }
    private UUID create(String token) throws Exception {
        UUID id=UUID.randomUUID(); assertThat(api.postAddress(token,AuthApi.addressBody(id,api.newAddress(),false)).statusCode()).isEqualTo(201); return id;
    }
    @Test void addressChangesWriteOnlyTheAddressTables() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); var before=fingerprints();
        UUID first=create(token), second=create(token); var book=api.addresses(token); var target=item(book,second);
        assertThat(api.putAddress(token,second,edit(target,api.newAddress(),true)).statusCode()).isEqualTo(200);
        assertThat(api.deleteAddress(token,first,version(item(api.addresses(token),first))).statusCode()).isEqualTo(200);
        var after=fingerprints(); assertThat(after.remove("saved_addresses")).isNotEqualTo(before.remove("saved_addresses"));
        assertThat(after.remove("saved_address_changes")).isNotEqualTo(before.remove("saved_address_changes"));
        assertThat(after).isEqualTo(before); assertThat(api.changeRows(user)).isEqualTo(3);
    }
    @Test void profileAndMobileEditsNeverTouchSavedAddresses() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); var address=api.newAddress();
        address=new AuthApi.Address(address.label(),address.recipientName(),user.mobile(),address.addressLine(),address.city());
        assertThat(api.postAddress(token,AuthApi.addressBody(UUID.randomUUID(),address,false)).statusCode()).isEqualTo(201);
        String before=fingerprint(api,user); long changes=api.changeRows(user);
        assertThat(api.putProfile(token,AuthApi.profileEdit(0,api.track("Profile Independence Name"),user.email(),null)).statusCode()).isEqualTo(200);
        String mobile=api.newUser().mobile(); assertThat(api.stageMobile(token,mobile).statusCode()).isEqualTo(202); api.activatePendingMobile(user);
        assertThat(json(api.profileOf(token))).containsEntry("mobile",mobile);
        assertThat(fingerprint(api,user)).isEqualTo(before); assertThat(api.changeRows(user)).isEqualTo(changes);
    }
    @Test void noTableReferencesSavedAddresses() throws Exception {
        assertThat(api.database().single("""
            SELECT count(*) FROM information_schema.referential_constraints r
            JOIN information_schema.constraint_column_usage c ON c.constraint_schema=r.unique_constraint_schema
              AND c.constraint_name=r.unique_constraint_name
            WHERE c.table_schema=? AND c.table_name='saved_addresses'
            """,Long.class,api.database().schema())).isZero();
    }
    @Test void anotherUsersBookIsNeverListedOrChanged() throws Exception {
        var owner=api.registered(); var other=api.registered(); String a=api.signIn(owner).accessToken(), b=api.signIn(other).accessToken();
        UUID id=create(a); create(a); create(a); create(b); create(b);
        String before=fingerprint(api,owner); var original=items(api.addresses(a)); var target=item(api.addresses(a),id);
        assertThat(items(api.addresses(b))).noneMatch(i -> id.toString().equals(i.get("id")));
        assertError(api.putAddress(b,id,AuthApi.addressEdit(api.newAddress(),true,0)),404,"NOT_FOUND");
        assertError(api.deleteAddress(b,id,0),404,"NOT_FOUND");
        var response=api.postAddress(b,AuthApi.addressBody(id,fields(target),false)); assertThat(response.statusCode()).isEqualTo(201);
        assertThat(items(response)).hasSize(3); assertThat(fingerprint(api,owner)).isEqualTo(before); assertThat(items(api.addresses(a))).isEqualTo(original);
    }
    private Map<String,String> fingerprints() throws Exception {
        var tables=api.database().query("""
          SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE'
          AND table_name NOT IN ('user_sessions','user_session_refresh_tokens') AND table_name NOT LIKE 'databasechangelog%'
          ORDER BY table_name
          """,r -> r.getString(1),api.database().schema());
        Map<String,String> values=new TreeMap<>();
        for(String table:tables) values.put(table,api.database().single("SELECT count(*)::text||':'||coalesce(md5(string_agg(t::text,'|' ORDER BY t::text)),'') FROM \""+table.replace("\"","\"\"")+"\" t",String.class));
        return values;
    }
}
