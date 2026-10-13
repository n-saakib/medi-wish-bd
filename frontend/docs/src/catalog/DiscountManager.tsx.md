# src/catalog/DiscountManager.tsx

Admin-only Discounts page with Active, Scheduled and Ended tabs, live counts, bounded paging, loading/empty/error states and Retry. Obsolete reads cannot replace the current tab. Create/edit dialogs refresh the list after mutations. Cancelling an unknown create closes the retained dialog; Retry pending discount reopens the same frozen command. New and Edit remain disabled until its exact retry succeeds, because a different tab or page cannot establish the create outcome. Staff-access success never clears a failed list read. Session/MFA redirects and server authorization remain authoritative.

Verified by the focused discount client/component tests; real API/browser verification is recorded separately by Ticket 16.

After a successful create, edit or End, focus moves to the selected status-tab button as the dialog closes. This enabled control remains mounted throughout the list reload, including when End removes the Edit opener. The saved notice remains a polite live status and does not steal focus. Cancellation still restores the original opener.

Cancelling an uncertain create focuses the selected enabled status tab because New/Edit become disabled while its outcome remains unknown. The retained UUID/intent and exact retry behavior remain unchanged.
