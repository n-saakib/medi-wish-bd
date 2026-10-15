package bd.mediwish.auth;
import bd.mediwish.address.MovableAddressChangeCalendar;
import org.junit.jupiter.api.*;
import java.util.UUID;
import static bd.mediwish.testsupport.ApiAssertions.*;
import static bd.mediwish.auth.AddressBookIT.*;
import static org.assertj.core.api.Assertions.*;

@Tag("integration") @Tag("recovery") @TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AddressBookRestartIT {
    private final AuthApi api=AuthApi.start(MovableAddressChangeCalendar.class);
    @AfterAll void close() throws Exception { api.close(); }
    @Test void addressesVersionsAndChangeAllowanceSurviveRestartAndReplay() throws Exception {
        api.app().bean(MovableAddressChangeCalendar.Calendar.class).set(AddressChangeLimitIT.FIXED);
        var user=api.registered(); String token=api.signIn(user).accessToken();
        String first=AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false);
        assertThat(api.postAddress(token,first).statusCode()).isEqualTo(201);
        assertThat(api.postAddress(token,AuthApi.addressBody(UUID.randomUUID(),api.newAddress(),false)).statusCode()).isEqualTo(201);
        var before=json(api.addresses(token)); var times=api.changeTimes(user);
        api.app().restart(); api.app().bean(MovableAddressChangeCalendar.Calendar.class).set(AddressChangeLimitIT.FIXED);
        assertThat(json(api.addresses(token))).isEqualTo(before); assertThat(api.changeTimes(user)).isEqualTo(times);
        assertThat(api.postAddress(token,first).statusCode()).isEqualTo(200);
        assertThat(json(api.addresses(token))).isEqualTo(before); assertThat(api.changeRows(user)).isEqualTo(2);
    }
}
