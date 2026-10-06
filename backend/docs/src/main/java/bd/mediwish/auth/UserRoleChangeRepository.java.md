# `UserRoleChangeRepository.java`

Source: [UserRoleChangeRepository.java](../../../../../../../src/main/java/bd/mediwish/auth/UserRoleChangeRepository.java)

Spring Data audit repository. findLatestForTarget(targetId, Pageable) returns History projections with occurrence time, nullable actor username and old/new roles, newest first with UUID tie-breaking. The actor is left joined, so deleted actors keep a history entry. RoleAssignmentService caps the page at 20; request IDs and internal identifiers stay backend evidence.
