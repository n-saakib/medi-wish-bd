# tests/ProductImages.test.tsx

Mounted image-card behavior tests exercise idle/loading/load-error/limit states, browser prechecks, preserved upload identity on transport/503 replay, fresh identity for new choices and discarded nonretryable refusals. Tests cover synchronous busy guards, dialog closure before replacement/remove/order transport, retained typed description on refusal, trimmed alt/version saves, authoritative stale/limit reloads, confirmation/cancel/removal focus and late callback rejection after leaving the page.


Repeated identical file refusals return focus to the existing status immediately, including when React skips a render because the error copy is unchanged. A mounted regression chooses two invalid files and requires focus after each refusal with no upload request.

The accepted main-image hint stays below the grid in the empty state as well as with images, matching plan T3 item5 and the browser state check.

A mounted regression renders and saves an unchanged NBSP/BOM description without losing its boundary characters.

A committed-upload regression makes the initial list succeed, the POST return 201, and the following list fail. It requires the load-failure alert, no upload-retry status, one POST throughout, and a successful list-only retry restoring the thumbnail and enabled controls.

The committed-upload regression also starts with focus on the upload control and requires the recovery alert to receive activeElement after the grid disappears. Committed removal at the eight-image limit hides stale thumbnails and offers GET-only retry restoring seven images and the upload slot. Parameterized stale alt/order and already-removed cases fail their recovery read, require focused alert with no refreshed-list success claim, and recover with one mutation throughout.
