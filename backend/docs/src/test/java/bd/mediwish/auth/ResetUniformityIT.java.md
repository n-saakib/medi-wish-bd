# ResetUniformityIT

Source: [ResetUniformityIT.java](../../../../../../../src/test/java/bd/mediwish/auth/ResetUniformityIT.java)

Six real HTTP cases—verified eligible, unverified, unknown, address-limited, issue-limited and eligible closing—share empty 202, no cookie or Retry-After signal and matching application-controlled content headers. Only eligible active/closing addresses receive captured code mail. Address exhaustion uses real requests before fixture verification; the shared issue window is seeded explicitly. Generated request IDs differ; transport Date is not compared.

The T7 collector measures 50 sequential HTTP reset requests for each of those six cases. Before each request it restores only the relevant limiter and code rows, then records the response time and Hibernate prepared-statement count. It prints each case's median, nearest-rank p95 and statement-count distribution, plus wrong- and right-confirm statement counts. A median spread above 25 ms is reported for investigation; it is not an SLA or an automatic test failure.

PasswordResetServiceTest contains the mock-backed service check: PasswordEncoder is untouched by request and EmailTransport is reached only by running the AfterCommitMailer task after commit. A controlled application clock also proves that 1,000 distinct unknown-address requests leave 1,000 fresh rows, then a request three hours later prunes them and retains its own fresh row. RecoveryContractIT covers the 16 KiB request limit, bounded field shapes and empty-or-Profile responses.

The collector's metrics are produced only when the integration test is run. It launches the local test-profile application; T7 still requires separately recording the plan's 50-request timing sample against the built local jar and the manual accessibility/browser evidence. The test owns its guarded schema and keeps mail capture in memory; it adds no test HTTP route or production dependency.
