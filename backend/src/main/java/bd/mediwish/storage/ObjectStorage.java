package bd.mediwish.storage;
import java.io.InputStream;
import java.util.Optional;
/** Create-only objects in the configured namespace; callers never provide namespace paths. */
public interface ObjectStorage {
    enum PutResult { CREATED, ALREADY_PRESENT }
    record StoredObject(long length, InputStream content) {}
    PutResult put(String key, byte[] bytes);
    Optional<StoredObject> get(String key);
    void delete(String key);
}
