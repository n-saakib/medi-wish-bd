package bd.mediwish.auth;
import bd.mediwish.address.MovableAddressChangeCalendar;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.*;
import org.springframework.beans.factory.NoSuchBeanDefinitionException;
import java.time.*;
import java.util.*;
import static bd.mediwish.testsupport.ApiAssertions.*;
import static bd.mediwish.auth.AddressBookIT.*;
import static org.assertj.core.api.Assertions.*;

@Tag("integration") @Tag("contract") @ExtendWith(OutputCaptureExtension.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AddressChangeLimitIT {
    static final Instant FIXED=Instant.parse("2030-01-16T06:00:00Z");
    private final AuthApi api=AuthApi.start(MovableAddressChangeCalendar.class);
    @AfterAll void close() throws Exception { api.close(); }
    @BeforeEach void reset() { calendar().reset(); }
    @AfterEach void privacy(CapturedOutput output) { api.assertLogsOmitSecrets(output); }
    private MovableAddressChangeCalendar.Calendar calendar() { return api.app().bean(MovableAddressChangeCalendar.Calendar.class); }
    private void at(String instant) { calendar().set(Instant.parse(instant)); }
    private UUID create(String token) throws Exception {
        UUID id=UUID.randomUUID(); assertThat(api.postAddress(token,AuthApi.addressBody(id,api.newAddress(),false)).statusCode()).isEqualTo(201); return id;
    }
    private java.net.http.HttpResponse<String> change(String token,UUID id) throws Exception {
        var old=item(api.addresses(token),id);
        return api.putAddress(token,id,edit(old,api.newAddress(),(boolean)old.get("isDefault")));
    }
    private void changes(String token,UUID id,int count) throws Exception {
        for(int i=0;i<count;i++) assertThat(change(token,id).statusCode()).isEqualTo(200);
    }
    private void allowance(String token,int week,int month) throws Exception {
        assertThat((Map<?,?>)json(api.addresses(token)).get("changeAllowance")).isEqualTo(Map.of("perWeek",5,"perMonth",10,"remainingThisWeek",week,"remainingThisMonth",month));
    }
    @Test void theSixthChangeInADhakaWeekIsRefusedAndChangesNothing() throws Exception {
        calendar().set(FIXED); var user=api.registered(); String token=api.signIn(user).accessToken();
        UUID first=create(token), second=create(token); create(token); changes(token,first,2);
        String before=fingerprint(api,user); assertError(change(token,first),409,"ADDRESS_CHANGE_LIMIT_REACHED");
        assertThat(fingerprint(api,user)).isEqualTo(before); assertThat(api.changeRows(user)).isEqualTo(5);
        var result=api.deleteAddress(token,first,version(item(api.addresses(token),first)));
        assertThat(result.statusCode()).isEqualTo(200); assertThat(item(result,second)).containsEntry("isDefault",true);
        assertError(api.postAddress(token,AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false)),409,"ADDRESS_CHANGE_LIMIT_REACHED");
        assertThat(api.changeRows(user)).isEqualTo(5);
    }
    @Test void removalsReplaysIdenticalEditsAndRefusalsDoNotCount() throws Exception {
        calendar().set(FIXED); var user=api.registered(); String token=api.signIn(user).accessToken();
        UUID first=create(token), second=create(token), third=create(token); changes(token,first,1);
        var current=item(api.addresses(token),first);
        assertError(api.postAddress(token,AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false)),409,"ADDRESS_BOOK_FULL");
        assertThat(api.postAddress(token,AuthApi.addressBody(first,fields(current),false)).statusCode()).isEqualTo(200);
        assertThat(api.putAddress(token,first,edit(current,fields(current),true)).statusCode()).isEqualTo(200);
        assertError(api.putAddress(token,first,AuthApi.addressEdit(api.newAddress(),true,0)),409,"STALE_UPDATE");
        assertError(api.postAddress(token,"{}"),400,"INVALID_REQUEST");
        assertError(api.postAddress(token,AuthApi.addressBody(first,api.newAddress(),false)),409,"ID_CONFLICT");
        var other=api.registered(); String otherToken=api.signIn(other).accessToken(); UUID otherId=create(otherToken);
        assertError(api.putAddress(token,otherId,AuthApi.addressEdit(api.newAddress(),false,0)),404,"NOT_FOUND");
        assertThat(api.deleteAddress(token,third,0).statusCode()).isEqualTo(200);
        assertThat(api.changeRows(user)).isEqualTo(4); create(token);
        assertError(change(token,second),409,"ADDRESS_CHANGE_LIMIT_REACHED"); assertThat(api.changeRows(user)).isEqualTo(5);
    }
    @Test void changingTheDefaultIsOneChange() throws Exception {
        calendar().set(FIXED); var user=api.registered(); String token=api.signIn(user).accessToken();
        UUID first=create(token), second=create(token); var old=item(api.addresses(token),second);
        var response=api.putAddress(token,second,edit(old,fields(old),true));
        assertThat(response.statusCode()).isEqualTo(200); assertThat(api.changeRows(user)).isEqualTo(3);
        assertThat(item(response,first)).containsEntry("version",1).containsEntry("isDefault",false);
        assertThat(item(response,second)).containsEntry("version",1).containsEntry("isDefault",true);
    }
    @Test void theAllowanceReportsTheEnforcedCounts() throws Exception {
        calendar().set(FIXED); var user=api.registered(); String token=api.signIn(user).accessToken(); allowance(token,5,10);
        UUID first=create(token); allowance(token,4,9); changes(token,first,1); allowance(token,3,8);
        var old=item(api.addresses(token),first);
        assertThat(api.postAddress(token,AuthApi.addressBody(first,fields(old),false)).statusCode()).isEqualTo(200);
        assertThat(api.putAddress(token,first,edit(old,fields(old),true)).statusCode()).isEqualTo(200);
        assertError(api.postAddress(token,"{}"),400,"INVALID_REQUEST");
        assertError(api.putAddress(token,first,AuthApi.addressEdit(api.newAddress(),true,0)),409,"STALE_UPDATE"); allowance(token,3,8);
        UUID second=create(token); allowance(token,2,7);
        assertThat(api.deleteAddress(token,second,0).statusCode()).isEqualTo(200); allowance(token,2,7);
        changes(token,first,2); allowance(token,0,5);
        assertError(change(token,first),409,"ADDRESS_CHANGE_LIMIT_REACHED"); allowance(token,0,5);
    }
    @Test void aCreateRetriedAfterItsAddressWasRemovedIsCreatedAgain() throws Exception {
        calendar().set(FIXED); var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=UUID.randomUUID();
        String body=AuthApi.addressBody(id,api.newAddress(),false);
        assertThat(api.postAddress(token,body).statusCode()).isEqualTo(201);
        assertThat(api.deleteAddress(token,id,0).statusCode()).isEqualTo(200);
        assertThat(api.postAddress(token,body).statusCode()).isEqualTo(201);
        assertThat(items(api.addresses(token))).hasSize(1); assertThat(api.changeRows(user)).isEqualTo(2);
    }
    @Test void aNewDhakaWeekStartsOnSundayAt1800Utc() throws Exception {
        calendar().set(FIXED); var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=create(token); changes(token,id,3);
        at("2030-01-20T17:59:59.999999Z"); changes(token,id,1);
        assertThat(api.changeTimes(user)).contains(Instant.parse("2030-01-20T17:59:59.999999Z"));
        assertError(change(token,id),409,"ADDRESS_CHANGE_LIMIT_REACHED"); allowance(token,0,5);
        at("2030-01-20T18:00:00Z"); allowance(token,5,5); changes(token,id,1); allowance(token,4,4);
    }
    @Test void theMonthlyLimitAppliesAcrossWeeks() throws Exception {
        at("2030-01-08T06:00:00Z"); var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=create(token); changes(token,id,4);
        at("2030-01-15T06:00:00Z"); changes(token,id,5);
        at("2030-01-22T06:00:00Z"); assertError(change(token,id),409,"ADDRESS_CHANGE_LIMIT_REACHED");
        at("2030-01-31T17:59:59.999999Z"); allowance(token,5,0); assertError(change(token,id),409,"ADDRESS_CHANGE_LIMIT_REACHED");
        at("2030-01-31T18:00:00Z"); allowance(token,5,10); changes(token,id,1);
    }
    @Test void aWeekSpanningTwoMonthsIsLimitedAsOneWeek() throws Exception {
        at("2029-12-31T06:00:00Z"); var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=create(token); changes(token,id,2);
        at("2030-01-02T06:00:00Z"); changes(token,id,2);
        at("2030-01-03T06:00:00Z"); assertError(change(token,id),409,"ADDRESS_CHANGE_LIMIT_REACHED");
        at("2030-01-06T18:00:00Z"); allowance(token,5,8); assertThat(api.changeTimes(user)).hasSize(5);
        changes(token,id,1); allowance(token,4,7); assertThat(api.changeTimes(user)).hasSize(3);
        assertThat(api.changeTimes(user)).allMatch(t -> !t.isBefore(Instant.parse("2029-12-31T18:00:00Z")));
        changes(token,id,4); assertError(change(token,id),409,"ADDRESS_CHANGE_LIMIT_REACHED"); allowance(token,0,3);
    }
    @Test void theLimitsApplyToEveryRolesOwnBookSeparately() throws Exception {
        calendar().set(FIXED);
        for(String role:List.of("CUSTOMER","DELIVERY_PERSON","ADMIN","MODERATOR")) {
            var user=api.registered(); if(!role.equals("CUSTOMER")){ api.removeRole(user,"CUSTOMER"); api.grantRole(user,role); }
            String token=role.equals("ADMIN")||role.equals("MODERATOR")?api.enroll(user).session().accessToken():api.signIn(user).accessToken();
            UUID id=create(token); changes(token,id,4); assertError(change(token,id),409,"ADDRESS_CHANGE_LIMIT_REACHED");
            assertThat(api.database().query("SELECT role FROM user_roles WHERE user_id = ?",r -> r.getString(1),api.userId(user))).containsExactly(role);
        }
        var other=api.registered(); String token=api.signIn(other).accessToken(); create(token); allowance(token,4,9);
    }
    @Test void anOverriddenWeeklyLimitIsEnforced() throws Exception {
        try(var overridden=AuthApi.start(Map.of("app.addresses.change-limits.per-week",1),MovableAddressChangeCalendar.class)) {
            overridden.app().bean(MovableAddressChangeCalendar.Calendar.class).set(FIXED);
            var user=overridden.registered(); String token=overridden.signIn(user).accessToken();
            assertThat((Map<?,?>)json(overridden.addresses(token)).get("changeAllowance")).isEqualTo(Map.of("perWeek",1,"perMonth",10,"remainingThisWeek",1,"remainingThisMonth",10));
            var response=overridden.postAddress(token,AuthApi.addressBody(UUID.randomUUID(),overridden.newAddress(),false));
            assertThat(response.statusCode()).isEqualTo(201);
            assertThat((Map<?,?>)json(response).get("changeAllowance")).isEqualTo(Map.of("perWeek",1,"perMonth",10,"remainingThisWeek",0,"remainingThisMonth",9));
            assertError(overridden.postAddress(token,AuthApi.addressBody(UUID.randomUUID(),overridden.newAddress(),false)),409,"ADDRESS_CHANGE_LIMIT_REACHED");
        }
    }
    @Test void theMovableCalendarStaysInItsOwnContext() throws Exception {
        try(var ordinary=AuthApi.start()) { assertThatThrownBy(() -> ordinary.app().bean(MovableAddressChangeCalendar.Calendar.class)).isInstanceOf(NoSuchBeanDefinitionException.class); }
        var user=api.registered(); var session=api.signIn(user); calendar().set(FIXED);
        assertThat(api.addresses(session.accessToken()).statusCode()).isEqualTo(200);
        assertThat(api.refresh(session.refreshToken()).statusCode()).isEqualTo(200);
        Instant before=Instant.now(); create(session.accessToken());
        Instant created=api.database().single("SELECT created_at FROM saved_addresses WHERE user_id = ?",java.sql.Timestamp.class,api.userId(user)).toInstant();
        assertThat(created).isBetween(before.minusSeconds(60),Instant.now().plusSeconds(60));
        assertThat(api.changeTimes(user)).containsExactly(FIXED);
    }
    @Test void pruningUsesTheEarlierCutoffAndOnlySuccessfulChangesCommitIt() throws Exception {
        String[] instants={"2030-01-02T06:00:00Z","2030-01-16T06:00:00Z","2030-04-03T06:00:00Z"};
        int[] comparisons={-1,1,0};
        for(int i=0;i<instants.length;i++) {
            Instant now=Instant.parse(instants[i]); calendar().set(now);
            var windows=bd.mediwish.address.AddressRules.changeWindows(now);
            assertThat(Integer.signum(windows.weekStart().compareTo(windows.monthStart()))).isEqualTo(comparisons[i]);
            Instant early=windows.weekStart().isBefore(windows.monthStart())?windows.weekStart():windows.monthStart();
            Instant late=windows.weekStart().isAfter(windows.monthStart())?windows.weekStart():windows.monthStart();
            var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=create(token);
            api.database().update("DELETE FROM saved_address_changes WHERE user_id=?",api.userId(user));
            List<Instant> seeded=List.of(early.minusNanos(1000),early,late.plusNanos(1000));
            for(Instant time:seeded) api.database().update("INSERT INTO saved_address_changes(id,user_id,changed_at) VALUES(?,?,?)",UUID.randomUUID(),api.userId(user),java.sql.Timestamp.from(time));
            var old=item(api.addresses(token),id); assertThat(api.changeTimes(user)).isEqualTo(seeded);
            assertThat(api.postAddress(token,AuthApi.addressBody(id,fields(old),false)).statusCode()).isEqualTo(200);
            assertThat(api.putAddress(token,id,AuthApi.addressEdit(fields(old),true,99)).statusCode()).isEqualTo(200);
            assertError(api.putAddress(token,id,AuthApi.addressEdit(api.newAddress(),true,99)),409,"STALE_UPDATE");
            assertError(api.postAddress(token,"{}"),400,"INVALID_REQUEST");
            assertThat(api.changeTimes(user)).isEqualTo(seeded);
            try(var failure=api.failCommitsWhere("saved_addresses","UPDATE","NEW.user_id='"+api.userId(user)+"'::uuid")) {
                assertError(change(token,id),500,"INTERNAL_ERROR");
                assertThat(api.changeTimes(user)).isEqualTo(seeded);
                assertThat(item(api.addresses(token),id)).isEqualTo(old);
            }
            changes(token,id,1);
            assertThat(api.changeTimes(user)).containsExactly(early,late.plusNanos(1000),now);
            long count=api.changeRows(user);
            assertThat(api.deleteAddress(token,id,version(item(api.addresses(token),id))).statusCode()).isEqualTo(200);
            assertThat(api.changeRows(user)).isEqualTo(count);
        }
    }
    @Test void exactMonthAndYearStartsCountInTheNewMonthWithoutResettingTheWeek() throws Exception {
        for(String end:List.of("2030-01-31T17:59:59.999999Z","2030-12-31T17:59:59.999999Z")) {
            Instant before=Instant.parse(end), boundary=before.plusNanos(1000);
            calendar().set(before); var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=create(token);
            allowance(token,4,9); calendar().set(boundary); allowance(token,4,10);
            changes(token,id,1); allowance(token,3,9);
            assertThat(api.changeTimes(user)).containsExactly(before,boundary);
        }
    }
    @Test void anOverriddenMonthlyLimitIsEnforcedIndependently() throws Exception {
        try(var overridden=AuthApi.start(Map.of("app.addresses.change-limits.per-week",7,"app.addresses.change-limits.per-month",1),MovableAddressChangeCalendar.class)) {
            overridden.app().bean(MovableAddressChangeCalendar.Calendar.class).set(FIXED);
            var user=overridden.registered(); String token=overridden.signIn(user).accessToken(); UUID id=UUID.randomUUID();
            var created=overridden.postAddress(token,AuthApi.addressBody(id,overridden.newAddress(),false));
            assertThat(created.statusCode()).isEqualTo(201);
            assertThat((Map<?,?>)json(created).get("changeAllowance")).isEqualTo(Map.of("perWeek",7,"perMonth",1,"remainingThisWeek",6,"remainingThisMonth",0));
            String fingerprint=fingerprint(overridden,user);
            assertError(overridden.putAddress(token,id,AuthApi.addressEdit(overridden.newAddress(),true,0)),409,"ADDRESS_CHANGE_LIMIT_REACHED");
            assertThat(fingerprint(overridden,user)).isEqualTo(fingerprint); assertThat(overridden.changeRows(user)).isOne();
        }
    }
    @Test void countsIncludeExactStartsAndExcludeExactEndsForEachWindow() throws Exception {
        calendar().set(FIXED); var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=create(token);
        var windows=bd.mediwish.address.AddressRules.changeWindows(FIXED);
        api.database().update("DELETE FROM saved_address_changes WHERE user_id=?",api.userId(user));
        for(Instant time:List.of(windows.monthStart(),windows.weekStart(),windows.weekEnd(),windows.monthEnd()))
            api.database().update("INSERT INTO saved_address_changes(id,user_id,changed_at) VALUES(?,?,?)",UUID.randomUUID(),api.userId(user),java.sql.Timestamp.from(time));
        // The week contains only its start; January contains month start, week start and week end.
        allowance(token,4,7);
        assertThat(api.changeRows(user)).isEqualTo(4); changes(token,id,1); allowance(token,3,6);
        assertThat(api.changeRows(user)).isEqualTo(5);
    }
    @Test void aLimitRefusalRollsBackPruningAndDeleteNeverPrunes() throws Exception {
        calendar().set(FIXED); var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=create(token);
        var windows=bd.mediwish.address.AddressRules.changeWindows(FIXED);
        Instant obsolete=windows.monthStart().minusNanos(1000);
        api.database().update("INSERT INTO saved_address_changes(id,user_id,changed_at) VALUES(?,?,?)",UUID.randomUUID(),api.userId(user),java.sql.Timestamp.from(obsolete));
        for(int i=0;i<4;i++) api.database().update("INSERT INTO saved_address_changes(id,user_id,changed_at) VALUES(?,?,?)",UUID.randomUUID(),api.userId(user),java.sql.Timestamp.from(FIXED));
        var before=api.changeTimes(user); assertThat(before).hasSize(6); allowance(token,0,5);
        assertError(change(token,id),409,"ADDRESS_CHANGE_LIMIT_REACHED");
        assertThat(api.changeTimes(user)).isEqualTo(before);
        assertThat(api.deleteAddress(token,id,0).statusCode()).isEqualTo(200);
        assertThat(api.changeTimes(user)).isEqualTo(before); allowance(token,0,5);
    }
}
