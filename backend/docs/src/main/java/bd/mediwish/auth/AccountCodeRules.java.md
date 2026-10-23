# `AccountCodeRules.java`

Source: [AccountCodeRules.java](../../../../../../../src/main/java/bd/mediwish/auth/AccountCodeRules.java)

Pure account-code rules accept verified ACTIVE or CLOSURE_REQUESTED accounts with usable password verifiers. Codes bind to one purpose and saved address, expire at the exact deadline, and stop after five wrong tries. LimitWindow rules preserve the shared issue gap across hourly count-window rollover; address and current-password limits use their own counters. All time and limits are inputs, with no Spring or database dependency.
