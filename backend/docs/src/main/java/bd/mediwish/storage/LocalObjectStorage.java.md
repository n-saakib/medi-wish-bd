# LocalObjectStorage.java

Local provider-neutral namespace storage. Canonical Product/image keys and normalized paths prevent escapes; symbolic-link ancestors are refused. Writes publish a temporary sibling using a create-only move: identical hashes replay, different bytes conflict without replacement. NIO readers allow deletion while a stream remains open. I/O failures expose only StorageUnavailableException.
