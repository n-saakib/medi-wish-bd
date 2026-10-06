# `SecurityConfigurationTest.java`

Source: [SecurityConfigurationTest.java](../../../../../../../src/test/java/bd/mediwish/web/SecurityConfigurationTest.java)

Focused settings/security tests: insecure cookies only for exclusively local/test profiles, hosted explicit credentialed CORS including PUT, allowed headers, no wildcard, local fallback and CSRF cookie attributes. The hierarchy gives ADMIN every lower role while an MFA authority grants none. Administrative search/role commands share Bearer protection and body-limit matchers; refresh stays outside that exemption.
