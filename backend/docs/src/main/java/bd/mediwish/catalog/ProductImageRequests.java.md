# ProductImageRequests.java

Parses the frozen multipart and JSON image contracts. Upload permits exactly one named file with a filename and singleton plain id, altText and replaces fields; unknown, repeated or misclassified fields are rejected. Shared catalog helpers preserve strict UUID and nonnegative version checks. Alt edits require explicit nullable text and version. Reorders require two arrays of unique UUIDs with identical sets, each bounded to eight.

Upload fields must also have actual singleton plain multipart Part provenance: their names must equal the servlet parameter keys before values are read. Query-only id, altText or replaces cannot supply command intent. Existing merged-parameter duplicate/unknown guards remain, and servlet text decoding preserves Unicode and per-request encoding. Multipart enumeration failures use the existing bounded multipart error handling.
