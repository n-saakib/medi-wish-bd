package bd.mediwish.auth;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.*;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import java.net.http.HttpResponse;
import java.util.*;
import static bd.mediwish.testsupport.ApiAssertions.*;
import static org.assertj.core.api.Assertions.*;

/** Real contract, privacy, default promotion and bounded command costs. */
@Tag("integration") @Tag("contract")
@ExtendWith(OutputCaptureExtension.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AddressBookIT {
    private final AuthApi api = AuthApi.start();
    @AfterAll void close() throws Exception { api.close(); }
    @AfterEach void privacy(CapturedOutput output) { api.assertLogsOmitSecrets(output); }

    @SuppressWarnings("unchecked")
    static List<Map<String,Object>> items(HttpResponse<String> response) {
        return (List<Map<String,Object>>) json(response).get("items");
    }
    @SuppressWarnings("unchecked")
    static Map<String,Object> allowance(HttpResponse<String> response) { return (Map<String,Object>)json(response).get("changeAllowance"); }
    static Map<String,Object> item(HttpResponse<String> response, UUID id) {
        return items(response).stream().filter(i -> id.toString().equals(i.get("id"))).findFirst().orElseThrow();
    }
    static long version(Map<String,Object> item) { return ((Number)item.get("version")).longValue(); }
    static AuthApi.Address fields(Map<String,Object> item) {
        return new AuthApi.Address((String)item.get("label"), (String)item.get("recipientName"),
                (String)item.get("mobile"), (String)item.get("addressLine"), (String)item.get("city"));
    }
    static String edit(Map<String,Object> item, AuthApi.Address fields, boolean isDefault) {
        return AuthApi.addressEdit(fields, isDefault, version(item));
    }
    static String fingerprint(AuthApi api, AuthApi.User user) throws Exception {
        return api.database().single("SELECT coalesce(md5(string_agg(a::text, '|' ORDER BY a.id)), '') "
                + "FROM saved_addresses a WHERE user_id = ?", String.class, api.userId(user));
    }
    private HttpResponse<String> create(String token, UUID id) throws Exception {
        var response = api.postAddress(token, AuthApi.addressBody(id, api.newAddress(), false));
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(json(response)).containsOnlyKeys("accountState", "limit", "changeAllowance", "items");
        for (var item : items(response)) assertThat(item).containsOnlyKeys("id", "label", "recipientName", "mobile", "addressLine", "city", "isDefault", "version");
        assertThat(allowance(response)).containsOnlyKeys("perWeek", "perMonth", "remainingThisWeek", "remainingThisMonth");
        return response;
    }
    @Test void theFullRoundTripPromotesTheOldestSurvivorAndBumpsItsVersion() throws Exception {
        var user = api.registered(); String token = api.signIn(user).accessToken();
        UUID first=UUID.randomUUID(), second=UUID.randomUUID(), third=UUID.randomUUID();
        create(token,first); create(token,second); var book=create(token,third);
        var target=item(book,second); var draft=api.newAddress();
        book=api.putAddress(token,second,edit(target,draft,true));
        assertThat(book.statusCode()).isEqualTo(200);
        assertThat(item(book,first)).containsEntry("isDefault",false).containsEntry("version",1);
        assertThat(item(book,second)).containsEntry("isDefault",true).containsEntry("version",1);
        book=api.deleteAddress(token,second,version(item(book,second)));
        assertThat(item(book,first)).containsEntry("isDefault",true).containsEntry("version",2);
        assertError(api.putAddress(token,first,AuthApi.addressEdit(api.newAddress(),true,1)),409,"STALE_UPDATE");
        book=api.deleteAddress(token,first,version(item(book,first)));
        book=api.deleteAddress(token,third,version(item(book,third)));
        assertThat(items(book)).isEmpty(); assertThat(api.changeRows(user)).isEqualTo(4);
    }
    @Test void fullBooksReplayEarlierCreatesAndRefuseOtherIds() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=UUID.randomUUID();
        var draft=api.newAddress(); String body=AuthApi.addressBody(id,draft,false);
        assertThat(api.postAddress(token,body).statusCode()).isEqualTo(201);
        create(token,UUID.randomUUID()); create(token,UUID.randomUUID());
        assertThat(api.postAddress(token,body).statusCode()).isEqualTo(200);
        assertError(api.postAddress(token,AuthApi.addressBody(UUID.randomUUID(),draft,false)),409,"ADDRESS_BOOK_FULL");
        assertError(api.postAddress(token,AuthApi.addressBody(id,api.newAddress(),false)),409,"ID_CONFLICT");
        assertThat(items(api.addresses(token))).hasSize(3); assertThat(api.changeRows(user)).isEqualTo(3);
    }
    @Test void requiredNullsAndMalformedRequestsAreBoundedAndChangeNothing() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken();
        String valid=AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false);
        for(String key:List.of("id","recipientName","mobile","addressLine","city","isDefault")) {
            String body=valid.replaceFirst("\\\""+key+"\\\":(\\\"[^\\\"]*\\\"|false)","\""+key+"\":null");
            assertError(api.postAddress(token,body),400,"INVALID_REQUEST");
        }
        for(String body:List.of("{", "{}", valid.replace("false","\"false\""), valid.substring(0,valid.length()-1)+",\"unknown\":1}"))
            assertError(api.postAddress(token,body),400,"INVALID_REQUEST");
        assertError(api.send("POST","/api/user/me/addresses",Map.of("Authorization","Bearer "+token,"Content-Type","text/plain"),valid),400,"INVALID_REQUEST");
        assertError(api.putAddress(token,UUID.randomUUID(),AuthApi.addressEdit(api.newAddress(),false,0)),404,"NOT_FOUND");
        assertError(api.deleteAddress(token,UUID.randomUUID(),0),404,"NOT_FOUND");
        assertThat(api.changeRows(user)).isZero(); assertThat(items(api.addresses(token))).isEmpty();
    }
    @Test void canonicalIdsVersionsAndDefaultRuleRefusalsAreBounded() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=UUID.randomUUID();
        var book=create(token,id); var target=item(book,id); String before=fingerprint(api,user);
        assertError(api.putAddress(token,id,edit(target,fields(target),false)),400,"INVALID_REQUEST");
        for(String bad:List.of("1-1-1-1-1","AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")) {
            assertError(api.postAddress(token,AuthApi.addressBody(id,api.newAddress(),false).replace(id.toString(),bad)),400,"INVALID_REQUEST");
            assertError(api.send("PUT","/api/user/me/addresses/"+bad,Map.of("Authorization","Bearer "+token,"Content-Type","application/json"),AuthApi.addressEdit(api.newAddress(),true,0)),400,"INVALID_REQUEST");
            assertError(api.send("DELETE","/api/user/me/addresses/"+bad+"?version=0",Map.of("Authorization","Bearer "+token),null),400,"INVALID_REQUEST");
        }
        for(String bad:List.of("","?version=-1","?version=1.5","?version=%2B1","?version=abc","?version=1000000000000000000"))
            assertError(api.send("DELETE","/api/user/me/addresses/"+id+bad,Map.of("Authorization","Bearer "+token),null),400,"INVALID_REQUEST");
        for(String bad:List.of("null","-1","1.5","\"0\"","9223372036854775808"))
            assertError(api.putAddress(token,id,AuthApi.addressEdit(api.newAddress(),true,0).replace("\"version\":0","\"version\":"+bad)),400,"INVALID_REQUEST");
        assertError(api.deleteAddress(token,id,1),409,"STALE_UPDATE");
        assertThat(fingerprint(api,user)).isEqualTo(before); assertThat(api.changeRows(user)).isOne();
    }
    static String pad(String body,int length) { return body.substring(0,body.length()-1)+" ".repeat(length-body.length())+"}"; }
    @Test void exactly16384BytesAreAcceptedAndOneMoreByteIsRejectedForBothCommands() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=UUID.randomUUID();
        var body=AuthApi.addressBody(id,api.newAddress(),false);
        assertThat(api.postAddress(token,pad(body,16384)).statusCode()).isEqualTo(201);
        var current=item(api.addresses(token),id); String update=edit(current,api.newAddress(),true);
        assertThat(api.putAddress(token,id,pad(update,16384)).statusCode()).isEqualTo(200);
        String before=fingerprint(api,user);
        assertError(api.postAddress(token,pad(AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false),16385)),400,"INVALID_REQUEST");
        assertError(api.putAddress(token,id,pad(edit(item(api.addresses(token),id),api.newAddress(),true),16385)),400,"INVALID_REQUEST");
        assertThat(fingerprint(api,user)).isEqualTo(before); assertThat(api.changeRows(user)).isEqualTo(2);
    }
    @Test void closingAccountsReadButCannotChangeTheirBook() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=UUID.randomUUID();
        create(token,id); String before=fingerprint(api,user); api.accountState(user,"CLOSURE_REQUESTED");
        assertThat(json(api.addresses(token))).containsEntry("accountState","CLOSURE_REQUESTED");
        assertError(api.postAddress(token,AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false)),409,"ACCOUNT_CLOSING");
        assertError(api.putAddress(token,id,AuthApi.addressEdit(api.newAddress(),true,0)),409,"ACCOUNT_CLOSING");
        assertError(api.deleteAddress(token,id,0),409,"ACCOUNT_CLOSING");
        assertThat(fingerprint(api,user)).isEqualTo(before); assertThat(api.changeRows(user)).isOne();
    }
    @Test void aMutationUsesABoundedNumberOfStatements() throws Exception {
        var stats=api.app().bean(EntityManagerFactory.class).unwrap(SessionFactory.class).getStatistics();
        stats.setStatisticsEnabled(true);
        try {
            for(String command:List.of("create","update","delete")) {
                long small=measure(stats,command,command.equals("create")?1:2,false);
                long large=measure(stats,command,command.equals("create")?2:3,false);
                assertThat(large).as(command+" count does not grow with book").isLessThanOrEqualTo(small);
                assertThat(large).isLessThanOrEqualTo(25);
                System.out.printf("T12 statements %s: small=%d large=%d%n",command,small,large);
            }
            System.out.printf("T12 default statements: create=%d delete=%d%n",measure(stats,"create",2,true),measure(stats,"delete",3,true));
        } finally { stats.setStatisticsEnabled(false); }
    }
    private long measure(org.hibernate.stat.Statistics stats,String command,int size,boolean defaultChange) throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID first=UUID.randomUUID(), last=first;
        for(int i=0;i<size;i++) { last=UUID.randomUUID(); if(i==0)first=last; create(token,last); }
        UUID target=defaultChange?first:last;
        var current=item(api.addresses(token),target); stats.clear();
        var response=switch(command) {
            case "create" -> api.postAddress(token,AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),defaultChange));
            case "update" -> api.putAddress(token,target,edit(current,api.newAddress(),false));
            default -> api.deleteAddress(token,target,version(current));
        };
        assertThat(response.statusCode()).isEqualTo(command.equals("create")?201:200);
        return stats.getPrepareStatementCount();
    }
}
