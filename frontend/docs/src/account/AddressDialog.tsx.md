# `src/account/AddressDialog.tsx`

Native accessible Add/Edit modal. Keeps one generated create id while open, preserves failed drafts, validates accepted field lengths/control characters and eleven ASCII mobile digits, and guards close during requests. Every opening announces the four server allowance numbers; zero remains advisory and Save enabled. First/current defaults cannot be cleared. Remove requires confirmation. Stale Reload replaces values/version and remains retryable after failure. Cancel/Escape after an unknown outcome reconcile the book; focus returns to the trigger or heading.

Verification: focused address projector/component units and the existing Ticket 12 browser suites. Full cumulative evidence is recorded by the story coordinator.

Field validation and optional label normalization use Java trim boundaries (ASCII through U+0020), preserving accepted NBSP and FEFF. Text length is checked after that trim; other submitted field values remain raw for server normalization.

Distinct keyed confirmation/action footers prevent a browser click on Keep from turning into Save during reconciliation. Tab/Shift+Tab wrap at the enabled modal control boundaries so focus stays inside the dialog.
