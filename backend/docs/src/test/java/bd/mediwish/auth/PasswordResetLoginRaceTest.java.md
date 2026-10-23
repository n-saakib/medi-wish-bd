# Password reset and sign-in race regression

Source: [`PasswordResetLoginRaceTest.java`](../../../../../../../src/test/java/bd/mediwish/auth/PasswordResetLoginRaceTest.java)

Composes real AuthenticationService and SessionService with repository/password/token seams. A controlled password comparison changes the persisted-verifier snapshot before the session lock, representing a reset that committed after password proof. Sign-in must return its existing generic authentication failure without persisting a session or issuing tokens. The pre-fix test observed an accepted session; the fixed flow passes the captured verified hash into the locked session boundary.
