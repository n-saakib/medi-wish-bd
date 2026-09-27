# `StaffBootstrapRepository.java`

Source: [`src/main/java/bd/mediwish/auth/StaffBootstrapRepository.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffBootstrapRepository.java)

Public Spring Data repository for `StaffBootstrap`.

| Member | Behavior |
| --- | --- |
| `claim(userId, at)` | Native `INSERT ... VALUES (1, :userId, :at) ON CONFLICT (id) DO NOTHING`; returns `1` when this transaction inserted the row and `0` when it already exists. A concurrent claim waits on the primary key until the first transaction ends, so only one provisioning can commit. |
| `superAdminUserId()` | The Super Admin's User ID, empty before provisioning or after that User is deleted. `StaffController` reads it for `superAdmin`. |

Covered by `FirstAdminProvisioningTest` (mocked) and `FirstAdminProvisioningIT`.
