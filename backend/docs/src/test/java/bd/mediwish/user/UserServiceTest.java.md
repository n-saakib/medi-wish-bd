# UserServiceTest

Unit tests cover normalized shared-User registration, Customer-role assignment, optional and blank email handling, password-verifier storage, separate username and mobile duplicate prechecks, oversized/malformed input rejection, and conversion of a bare PostgreSQL SQL-state `23505` exception into the bounded duplicate outcome at the service seam. Test names distinguish the short-circuiting username case from the mobile lookup case and do not imply coverage of an untested exception wrapper.
