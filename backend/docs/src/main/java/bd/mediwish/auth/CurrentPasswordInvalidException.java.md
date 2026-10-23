# `CurrentPasswordInvalidException.java`

Source: [CurrentPasswordInvalidException.java](../../../../../../../src/main/java/bd/mediwish/auth/CurrentPasswordInvalidException.java)

Public bounded signal for missing, blank or incorrect current-password confirmation during an email change. It stores no supplied password or contact value. ProfileService preserves its counter/audit writes through noRollbackFor; the shared web adapter maps the signal to CURRENT_PASSWORD_INVALID.
