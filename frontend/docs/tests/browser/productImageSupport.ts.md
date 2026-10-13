# Product image browser/API support

`tests/browser/productImageSupport.ts` supplies the Ticket 15 accepted R1–R6 contract to real Playwright tests. It reuses Ticket 14 API sessions, Product builders and token renewal instead of introducing another authentication client.

`uploadImage(api,actor,productId,bytes,options)` submits multipart with a current Bearer token. `listImages` verifies exact list and image shapes, bounds, ordered positions and unique identities. `updateAlt`, `reorderImages` and `removeImage` return raw responses so success and security/error cases exercise the same routes. `ImageView`, `ImageList`, `imageKeys`, `imageMessages` and `expectImage` preserve the public projection; storage keys, hashes, filenames and actor ids are absent. `expectImageError` checks exact localized code/message/envelope, matching response correlation and `no-store`.

`publicImage` permits only a lowercase UUID public image path on the API origin. `optimizerUrl` targets the frontend origin with explicit URL, width and quality; `optimizedImage` sends `Accept: image/webp,*/*` so the built server's real optimizer is exercised. `openImages` opens a known Product and waits for its Images heading.

`storageDirectory`, `storageFiles` and `imagePath` inspect only the harness's absolute `test-browser-{schema suffix}` namespace, require the checked synthetic schema and reject namespace/object symlinks. Files are listed as sorted portable relative paths. These guards keep fixture inspection and controlled failure tests within their run's storage; production paths are never accepted. Unit evidence is in `tests/productImageSupport.test.ts`.

The storage guard requires the exact worktree storage root and the namespace matching this run schema; object paths also refuse symlinks along every ancestor.

`expectImageSuccess` requires a successful status, nonempty `X-Request-ID` and `Cache-Control: no-store`. Upload (including replay), list, alt edit, reorder and remove helpers enforce it on successes while returning rejected responses for exact error assertions.

Alt projection follows Java catalog normalization: surrounding ASCII spaces are refused in stored metadata, ISO controls anywhere are forbidden, and NBSP/BOM at the edges are preserved. Length is measured in UTF-16 code units, matching Java String.length(), rather than Unicode code points.
