# src/catalog/ProductImages.tsx

Client image card for an existing Product. Lists at most eight images with a 2/4-column responsive grid and accessible thumbnail labels. Native modal editing supports trimmed alt text, moving an image to main, replacement and confirmed removal. The synchronous pending guard disables every image control. Upload choices reset the file input and precheck the accepted 3 MiB JPEG/PNG policy. Transport/503 replay retains the original file, id, alt text and replacement identity; other refusals discard replay. Stale/order/limit/removal conflicts refresh authoritative metadata. Generation and list sequence guards discard callbacks after navigation or unmount. Success focus follows the resulting image identity or the surviving removal target; errors focus the card or retained dialog text.


Repeated identical file refusals return focus to the existing status immediately, including when React skips a render because the error copy is unchanged. A mounted regression chooses two invalid files and requires focus after each refusal with no upload request.

The accepted main-image hint stays below the grid in the empty state as well as with images, matching plan T3 item5 and the browser state check.

Description saves trim only ASCII spaces, preserving accepted Unicode boundaries and forwarding control characters for backend refusal.

After a committed upload or removal, or an authoritative conflict recovery, a failed metadata read hides the stale grid, clears status, and focuses the list-load alert. Only a GET retry remains available; it cannot replay the completed mutation. Refreshed-list messages appear only after a successful read. Pending controls remain disabled until the refresh settles.
