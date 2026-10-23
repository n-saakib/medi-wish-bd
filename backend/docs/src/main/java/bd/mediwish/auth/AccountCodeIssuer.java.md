# Account code issuance

Source: [`AccountCodeIssuer.java`](../../../../../../../src/main/java/bd/mediwish/auth/AccountCodeIssuer.java)

Issues six ASCII digits from SecureRandom while the caller holds the User lock. Both purposes share issue:<user UUID>: at most five accepted issues per hour and sixty seconds between issues even across the hour boundary. A newer issue checks the same-purpose live verifier and redraws if the six digits would repeat it, then deletes only that purpose before flushing its replacement. The issue counter is read with a row lock (after the User lock) so concurrent cleanup skips it until commit. The database stores the purpose/UUID-bound HMAC and a fresh limit entity; the returned raw code exists only for mail composition.
