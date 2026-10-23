# `PublicCatalogServiceTest.java`

Mockito unit coverage for repository order and public category mapping, unknown/inactive category short-circuits, fixed 24-item pagination and last-page rejection, empty categories, one batched main-image and price read, missing-price omission, equipment projection, inactive-category details and image URL/order mapping. It also checks that absent Product reads become the bounded catalog not-found exception. These tests do not replace the real-PostgreSQL query and transaction proof.

Fixture helpers compute mock-derived IDs and price maps before starting Mockito stubs, keeping each stub independent.
