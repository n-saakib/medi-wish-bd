# DiscountController.java

Thin HTTP adapter for the four accepted Admin discount routes. List requires a valid status and bounded catalog pagination. Create parses an allow-listed JSON body and returns 201 for a new client id or 200 for a replay; update and end forward the parsed version and authenticated current user. The service owns transactional rules, and the security chain checks fresh roles and MFA before body handling. No delete or preview route exists.

Verification is recorded in the Ticket 16 evidence; preparation and discovery alone are not acceptance.
