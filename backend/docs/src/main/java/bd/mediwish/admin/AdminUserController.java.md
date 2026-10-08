# `AdminUserController.java`

Source: [AdminUserController.java](../../../../../../../src/main/java/bd/mediwish/admin/AdminUserController.java)

The three administrative routes: POST /api/admin/users/search, GET /api/admin/users/{UUID} and PUT /api/admin/users/{UUID}/roles. Only an authenticator-verified Admin reaches them. Username filters travel in a request body, never a URL.

Local Search and RoleCommand records are constructed from JsonNode: object shape, allowed property names, exact role names and integral numeric types are checked explicitly. Unknown properties, nulls, numeric strings, fractions, overflow and malformed UUIDs are refused before the service runs. The search trims/lowercases its prefix, limits it to 50 characters, defaults to page 0/size 20 and caps size at 50. The role command requires a nonnegative long version.

Business rules, database reads and changes belong to RoleAssignmentService. Json-only command routes share the 16 KiB limit and Bearer CSRF exemption. AdminUserControllerTest covers strict request behavior and normalization; integration tests cover the secured public routes.
