# src/catalog/DiscountManager.tsx

Admin-only Discounts page with Active, Scheduled and Ended tabs, live counts, bounded paging, loading/empty/error states and Retry. Obsolete reads cannot replace the current tab. Create/edit dialogs refresh the list after mutations. Cancelling an unknown create closes the retained dialog; Retry pending discount reopens the same frozen command. New and Edit remain disabled until its exact retry succeeds, because a different tab or page cannot establish the create outcome. Staff-access success never clears a failed list read. Session/MFA redirects and server authorization remain authoritative.

Verified by the focused discount client/component tests; real API/browser verification is recorded separately by Ticket 16.

After a successful create, edit or End, focus moves to the selected status-tab button as the dialog closes. This enabled control remains mounted throughout the list reload, including when End removes the Edit opener. The saved notice remains a polite live status and does not steal focus. Cancellation still restores the original opener.

Cancelling an uncertain create focuses the selected enabled status tab because New/Edit become disabled while its outcome remains unknown. The retained UUID/intent and exact retry behavior remain unchanged.

Selecting the current status and page is a no-op, preserving a loaded result or its pending read. Selecting the same status from a later page still returns to page zero. Stale update/End Reload discards the editor and refreshes the list/counts without a saved notice; focus moves to the enabled selected status tab after the dialog is removed.

Keyboard page turns focus the selected enabled status tab before removing the pager for loading. A completed read returns focus to the first enabled pager button only while that same tab still owns focus; an empty total keeps focus on the tab, and an empty later page with a nonzero total returns focus to Previous. Moving focus elsewhere during loading is respected. Refresh and subsequent navigation clear the pending focus transfer; shared pager behavior is unchanged.
