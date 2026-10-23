# src/lib/productImages.ts

Exports strict public ProductImage metadata/list projection, safe public source URL generation, JPEG/PNG file prechecks, translated fallback alt text and the authenticated image client. Metadata requires matching lowercase UUID public paths, contiguous unique positions, accepted MIME/dimensions/size and bounded alt text. The client sends multipart uploads without setting their Content-Type, includes optional replacement/alt parts and sends full expected order/version on metadata commands. Responses retain only the public contract. The shared session client owns authentication renewal and the ten-second operation timeout. Delete accepts only 204.


Alt projection preserves NBSP, BOM and other Unicode whitespace accepted by Java String.trim; ASCII boundary spaces and ISO control characters remain invalid canonical metadata.

Ticket 17 widens imageAlt to the public altText projection, so public card/gallery metadata can reuse the translated fallback without carrying staff-only image fields.
