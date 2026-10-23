# `AccountCodeRepository.java`

Source: [AccountCodeRepository.java](../../../../../../../src/main/java/bd/mediwish/auth/AccountCodeRepository.java)

Purpose-specific lookup and bulk JPQL deletes own challenge persistence. Both deletes flush pending entity changes before executing and clear the persistence context afterward, so replacements cannot conflict with a deferred old-row delete. Callers flush User mutations first and retain immutable counter snapshots or reload before later writes.
