package bd.mediwish.auth;
import org.junit.jupiter.api.*;
import java.util.UUID;
import static bd.mediwish.auth.AddressBookIT.*;
import static org.assertj.core.api.Assertions.*;

@Tag("integration") @TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AddressBookUnicodeIT {
    private final AuthApi api=AuthApi.start();
    @AfterAll void close() throws Exception { api.close(); }
    @Test void bengaliRecipientAddressAndCityRoundTripOnUtf8() throws Exception {
        Assumptions.assumeTrue("UTF8".equals(api.database().single("SHOW server_encoding",String.class)),"Bengali requires UTF8 cluster 55433");
        var user=api.registered(); String token=api.signIn(user).accessToken(); UUID id=UUID.randomUUID(); var seed=api.newAddress();
        var address=new AuthApi.Address(seed.label(),api.track("বাংলাদেশের গ্রাহক"),seed.mobile(),api.track("বাড়ি দশ সড়ক বিশ"),api.track("ঢাকা শহর বাংলাদেশ"));
        assertThat(api.postAddress(token,AuthApi.addressBody(id,address,false)).statusCode()).isEqualTo(201);
        assertThat(fields(item(api.addresses(token),id))).isEqualTo(address);
    }
}
