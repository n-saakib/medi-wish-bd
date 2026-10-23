# `ProfileEdit.java`

Source: [`ProfileEdit.java`](../../../../../../../src/main/java/bd/mediwish/user/ProfileEdit.java)

The four required editable profile fields (full name, email, date of birth and version), plus optional `currentPassword` for reauthentication on email changes. Diagnostics print only the version; no password or contact value is exposed. The controller checks JSON shape and types; `ProfileRules` normalizes and validates the values before a service compares them with persisted state.
