# ProductImageInspector.java

Accepts at most 3 MiB PNG/JPEG with matching declared type and filename extension. Checks header dimensions before decoding, strips metadata and trailing payload by re-encoding, bounds encoded size, and computes SHA-256 over stored bytes. Uses memory streams and always disposes readers/writers.
