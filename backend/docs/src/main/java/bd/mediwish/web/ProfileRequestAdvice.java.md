# ProfileRequestAdvice.java

Source: [ProfileRequestAdvice.java](../../../../../../../src/main/java/bd/mediwish/web/ProfileRequestAdvice.java)

## Purpose

Controller-specific advice maps non-JSON bodies on the profile command contract to 400 INVALID_REQUEST through ApiErrors. Older authentication controllers retain their 415 contract. Request correlation and no-store headers come from RequestCorrelationFilter; no private request values enter responses or logs.

ProfileControllerTest checks both write routes with text/plain.
