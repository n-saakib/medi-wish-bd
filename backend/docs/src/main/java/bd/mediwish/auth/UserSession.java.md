# UserSession

JPA mapping for a refresh-session family. It stores the User binding, creation, expiry and last-use timestamps plus nullable revocation metadata. Revocation is monotonic and is checked for every access-token session binding.
