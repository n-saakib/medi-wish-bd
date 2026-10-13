# ProductImageRequests.java

Parses the frozen multipart and JSON image contracts. Upload permits exactly one named file with a filename and singleton plain id, altText and replaces fields; unknown, repeated or misclassified fields are rejected. Shared catalog helpers preserve strict UUID and nonnegative version checks. Alt edits require explicit nullable text and version. Reorders require two arrays of unique UUIDs with identical sets, each bounded to eight.
