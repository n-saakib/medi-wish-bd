# src/catalog/DiscountDialog.tsx

Modal create/edit/end flow with target pickers, percentage/flat value, Dhaka start/end dates, field-specific validation and first-invalid focus. Product searches ignore obsolete responses and failed pickers offer Retry. Started rows keep Starts disabled and targets immutable. End now confirms once. Pending commands disable controls. Ambiguous create outcomes freeze the submitted fields and UUID for an identical retry; cancelling requests a list refresh while retaining that command in the mounted, closed dialog. The controlled open prop allows reopening without losing its original intent. Ordinary close restores opener focus. No customer-price arithmetic is performed.

Verified by the focused discount client/component tests; real API/browser verification is recorded separately by Ticket 16.

Ordinary Tab and Shift+Tab wrap between the first and last enabled dialog controls, preventing native browser focus from leaving the modal at either boundary. The checked target radio is the group's keyboard stop; unchecked radios and disabled controls are excluded. Native traversal within date fields and modified Tab shortcuts remain untouched, and Escape retains the existing cancel behavior. The control list is read at the key event so the End confirmation and pending states use their current controls.

Entering End confirmation focuses Confirm, and cancelling that confirmation focuses the restored End now button. These transitions replace the action controls, so explicit focus prevents keyboard users being left on the document body.

Cancel and Escape close the native dialog before notifying the manager, releasing the browser's inert background before opener focus is restored. Pending commands still prevent cancellation. This ordering also applies when an unknown create is retained as a closed dialog.
