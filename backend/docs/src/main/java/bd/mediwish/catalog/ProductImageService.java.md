# ProductImageService.java

Coordinates image commands without changing the Product version. Authorizes catalog editors, bounds decoding to two concurrent readers with a five-second wait, sanitizes bytes before opening a transaction, and serializes writes with the existing Product row lock. Upload ids are replayable only for matching Product, alt text and sanitized hash; retired ids never return. Replacement/removal retires ids and deletes objects synchronously after commit, with class-only warnings on deletion failure. A rolled-back newly created object is removed only under a fresh Product lock when no committed row references its key. Public reads require a metadata row and matching extension.


The package-private constructor allows a shorter decode wait for deterministic saturation tests; the injected production constructor always uses5000ms.

After locking the Product, upload claims its new image ID before the authoritative live/retired replay check and holds that claim through commit or rollback. This prevents another Product/process from creating and retiring that ID during storage put. Each upload acquires only one identity lock after its Product lock; removal/replacement already serialize retirement under the owning Product lock and acquire no additional identity locks, avoiding cycles between replacing uploads.
