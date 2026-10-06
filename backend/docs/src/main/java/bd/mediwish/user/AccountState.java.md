# `AccountState.java`

Source: [`AccountState.java`](../../../../../../../src/main/java/bd/mediwish/user/AccountState.java)

Persisted User profile state. `ACTIVE` permits edits; `CLOSURE_REQUESTED` leaves profile reads available and blocks every profile or mobile mutation. Ticket 46 sets closure requested and Ticket 47 extends the terminal state and database constraint.
