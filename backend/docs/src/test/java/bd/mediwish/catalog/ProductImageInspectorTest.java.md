# ProductImageInspectorTest.java

Generates synthetic PNG/JPEG fixtures to prove decoding and sanitization, dimensions before allocation, mismatched/executable/truncated content refusal, trailing PNG payload removal and JPEG Exif removal. Runs a second JVM on the same runtime to verify deterministic sanitized hashes across process restart; no vendor-specific golden bytes are committed.


A maximally compressed synthetic PNG proves that the re-encoded result is separately bounded even when the original bytes fit the configured limit.
The 4096 x 4096 sixteen-bit RGBA case builds a compressed synthetic PNG without allocating fixture pixels, then records inspecting-thread allocated bytes, reset heap-pool peak usage, initial used heap and JVM maximum heap. This is informational capacity evidence, not a production load SLA. Two allocations exceeding about 25% of maximum heap require the accepted permit/bit-depth decision before T7 closes.

The encoded-size refusal uses a valid low-quality JPEG whose accepted 0.90-quality sanitization is larger than the input; both sizes are measured before asserting the configured output cap. The previous PNG compression-level fixture produced identical lengths on the pinned JDK and was corrected without changing production policy.
