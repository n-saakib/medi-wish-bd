package bd.mediwish.address;

import bd.mediwish.user.User;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.UUID;

public record AddressBookView(String accountState, int limit, AddressRules.ChangeAllowance changeAllowance, List<Item> items) {
    public record Item(UUID id, String label, String recipientName, String mobile, String addressLine,
                       String city, @JsonProperty("isDefault") boolean isDefault, long version) {}
    public static AddressBookView from(User user, List<SavedAddress> addresses, AddressRules.ChangeAllowance allowance) {
        return new AddressBookView(user.accountState().name(), AddressRules.MAX_ADDRESSES, allowance,
                addresses.stream().map(a -> new Item(a.id(), a.label(), a.recipientName(), a.mobile(),
                        a.addressLine(), a.city(), a.isDefault(), a.version())).toList());
    }
}
