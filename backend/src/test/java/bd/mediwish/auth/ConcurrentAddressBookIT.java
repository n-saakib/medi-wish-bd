package bd.mediwish.auth;
import bd.mediwish.address.*;
import bd.mediwish.user.AccountClosingException;
import org.junit.jupiter.api.*;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import static bd.mediwish.testsupport.ApiAssertions.*;
import static bd.mediwish.auth.AddressBookIT.*;
import static org.assertj.core.api.Assertions.*;

@Tag("integration") @Tag("recovery") @TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ConcurrentAddressBookIT {
    private final AuthApi api=AuthApi.start(MovableAddressChangeCalendar.class);
    @AfterAll void close() throws Exception { api.close(); }
    @BeforeEach void reset() { api.app().bean(MovableAddressChangeCalendar.Calendar.class).reset(); }
    private AddressBookService service() { return api.app().bean(AddressBookService.class); }
    private UUID create(String token) throws Exception {
        UUID id=UUID.randomUUID(); assertThat(api.postAddress(token,AuthApi.addressBody(id,api.newAddress(),false)).statusCode()).isEqualTo(201); return id;
    }
    private AddressFields fields(AuthApi.Address address) { return new AddressFields(address.label(),address.recipientName(),address.mobile(),address.addressLine(),address.city()); }
    private void fiveChanges(String token,UUID id,int edits) throws Exception {
        for(int i=0;i<edits;i++) { var old=item(api.addresses(token),id); assertThat(api.putAddress(token,id,edit(old,api.newAddress(),(boolean)old.get("isDefault"))).statusCode()).isEqualTo(200); }
    }
    @Test void aBurstOfFourthAddressRequestsLeavesExactlyThreeRows() throws Exception {
        for(int round=0;round<5;round++) {
            var user=api.registered(); String token=api.signIn(user).accessToken(); create(token); create(token);
            burst(token,"ADDRESS_BOOK_FULL"); invariant(user,3);
        }
    }
    private void burst(String token,String error) throws Exception {
        var start=new CountDownLatch(1);
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<HttpResponse<String>>> futures=new ArrayList<>();
            for(int i=0;i<8;i++) { String body=AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false);
                futures.add(executor.submit(() -> { start.await(); return api.postAddress(token,body); })); }
            start.countDown(); int successes=0;
            for(var future:futures) { var response=future.get(20,TimeUnit.SECONDS); if(response.statusCode()==201) successes++; else assertError(response,409,error); }
            assertThat(successes).isOne();
        }
    }
    @Test void twoCreatesBlockedOnTheUserLockSerializeToOneSuccessAndOneFull() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); create(token); create(token); UUID userId=api.userId(user);
        try(var gate=lock(userId); var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var one=executor.submit(() -> createOutcome(userId)); var two=executor.submit(() -> createOutcome(userId));
            awaitBlocked(gate,2); gate.commit();
            assertThat(List.of(one.get(10,TimeUnit.SECONDS),two.get(10,TimeUnit.SECONDS))).containsExactlyInAnyOrder("created","full");
        }
        invariant(user,3);
    }
    private String createOutcome(UUID userId) {
        try { assertThat(service().create(userId,UUID.randomUUID(),fields(api.newAddress()),false).created()).isTrue(); return "created"; }
        catch(AddressBookFullException expected) { return "full"; }
    }
    @Test void concurrentCreatesIntoAnEmptyBookLeaveExactlyOneDefault() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken();
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var start=new CountDownLatch(1); List<Future<HttpResponse<String>>> requests=new ArrayList<>();
            for(int i=0;i<3;i++) { var body=AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false); requests.add(executor.submit(() -> {start.await();return api.postAddress(token,body);})); }
            start.countDown(); for(var request:requests) assertThat(request.get(10,TimeUnit.SECONDS).statusCode()).isEqualTo(201);
        }
        invariant(user,3);
    }
    @Test void racingDefaultMovesAndDefaultDeletionNeverLeaveZeroOrTwoDefaults() throws Exception {
        for(int round=0;round<20;round++) {
            var user=api.registered(); String token=api.signIn(user).accessToken(); UUID first=create(token), second=create(token); create(token);
            var target=item(api.addresses(token),second);
            var results=AuthApi.race(() -> api.deleteAddress(token,first,0),() -> api.putAddress(token,second,edit(target,AddressBookIT.fields(target),true)));
            for(var result:results) if(result.statusCode()!=200) assertError(result,409,"STALE_UPDATE");
            invariant(user,items(api.addresses(token)).size());
        }
    }
    @Test void aClosureCommittedWhileACreateWaitsPreventsTheWrite() throws Exception {
        var user=api.registered(); UUID id=api.userId(user);
        try(var gate=lock(id); var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var request=executor.submit(() -> service().create(id,UUID.randomUUID(),fields(api.newAddress()),false));
            awaitBlocked(gate,1);
            try(var statement=gate.prepareStatement("UPDATE users SET account_state='CLOSURE_REQUESTED' WHERE id=?")){statement.setObject(1,id);statement.executeUpdate();}
            gate.commit(); assertThatThrownBy(() -> request.get(10,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class).hasCauseInstanceOf(AccountClosingException.class);
        }
        assertThat(api.database().single("SELECT count(*) FROM saved_addresses WHERE user_id=?",Long.class,id)).isZero(); assertThat(api.changeRows(user)).isZero();
    }
    @Test void aFailedCommitLeavesNoPartialRowAndARetrySucceeds() throws Exception {
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=UUID.randomUUID(); String body=AuthApi.addressBody(id,api.newAddress(),false);
        try(var failure=api.failCommitsWhere("saved_addresses","INSERT","NEW.user_id='"+api.userId(user)+"'::uuid")) {
            assertError(api.postAddress(token,body),500,"INTERNAL_ERROR"); assertThat(items(api.addresses(token))).isEmpty(); assertThat(api.changeRows(user)).isZero();
        }
        assertThat(api.postAddress(token,body).statusCode()).isEqualTo(201); assertThat(api.changeRows(user)).isOne(); invariant(user,1);
        assertThat(api.postAddress(token,body).statusCode()).isEqualTo(200); assertThat(api.changeRows(user)).isOne();
    }
    @Test void aBurstAtTheFifthChangeAllowsExactlyOne() throws Exception {
        api.app().bean(MovableAddressChangeCalendar.Calendar.class).set(AddressChangeLimitIT.FIXED);
        for(int round=0;round<5;round++) {
            var user=api.registered(); String token=api.signIn(user).accessToken(); UUID first=create(token); fiveChanges(token,first,3);
            burst(token,"ADDRESS_CHANGE_LIMIT_REACHED"); invariant(user,2); assertThat(api.changeRows(user)).isEqualTo(5);
        }
    }
    @Test void twoChangesBlockedOnTheUserLockAtTheFifthChangeSerializeToOneSuccessAndOneLimit() throws Exception {
        api.app().bean(MovableAddressChangeCalendar.Calendar.class).set(AddressChangeLimitIT.FIXED);
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID first=create(token),second=create(token); fiveChanges(token,first,2);
        UUID userId=api.userId(user); var book=api.addresses(token); var a=item(book,first); var b=item(book,second);
        try(var gate=lock(userId); var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var one=executor.submit(() -> updateOutcome(userId,first,a)); var two=executor.submit(() -> updateOutcome(userId,second,b));
            awaitBlocked(gate,2); gate.commit(); assertThat(List.of(one.get(10,TimeUnit.SECONDS),two.get(10,TimeUnit.SECONDS))).containsExactlyInAnyOrder("saved","limit");
        }
        assertThat(api.changeRows(user)).isEqualTo(5);
    }
    private String updateOutcome(UUID user,UUID id,Map<String,Object> old) {
        try { service().update(user,id,fields(api.newAddress()),(boolean)old.get("isDefault"),version(old)); return "saved"; }
        catch(AddressChangeLimitException expected) { return "limit"; }
    }
    @Test void aRemovalRacingTheFifthChangeIsNotCounted() throws Exception {
        api.app().bean(MovableAddressChangeCalendar.Calendar.class).set(AddressChangeLimitIT.FIXED);
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID first=create(token),second=create(token),third=create(token); fiveChanges(token,first,1);
        var target=item(api.addresses(token),second);
        var results=AuthApi.race(() -> api.deleteAddress(token,third,0),() -> api.putAddress(token,second,edit(target,api.newAddress(),false)));
        assertThat(results).extracting(HttpResponse::statusCode).containsExactly(200,200); assertThat(api.changeRows(user)).isEqualTo(5); invariant(user,2);
    }
    private void invariant(AuthApi.User user,int count) throws Exception {
        assertThat(api.database().single("SELECT count(*) FROM saved_addresses WHERE user_id=?",Long.class,api.userId(user))).isEqualTo(count);
        assertThat(api.database().single("SELECT count(*) FROM saved_addresses WHERE user_id=? AND is_default",Long.class,api.userId(user))).isOne();
    }
    private Connection lock(UUID id) throws Exception {
        var connection=api.database().connect(); connection.setAutoCommit(false);
        try(var statement=connection.prepareStatement("SELECT id FROM users WHERE id=? FOR UPDATE")){statement.setObject(1,id);try(var row=statement.executeQuery()){assertThat(row.next()).isTrue();}}
        return connection;
    }
    private void awaitBlocked(Connection gate,int count) throws Exception {
        int pid; try(var statement=gate.createStatement();var row=statement.executeQuery("SELECT pg_backend_pid()")){assertThat(row.next()).isTrue();pid=row.getInt(1);}
        long deadline=System.nanoTime()+Duration.ofSeconds(2).toNanos();
        String sql="""
            WITH RECURSIVE blocked(pid) AS (
              SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND ?=ANY(pg_blocking_pids(pid))
              UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
              WHERE a.datname=current_database() AND a.usename=current_user
            ) SELECT count(*) FROM blocked
            """;
        while(System.nanoTime()<deadline){if(api.database().single(sql,Long.class,pid)>=count)return;Thread.sleep(10);}
        fail("Expected "+count+" blocked PostgreSQL transactions");
    }
}
