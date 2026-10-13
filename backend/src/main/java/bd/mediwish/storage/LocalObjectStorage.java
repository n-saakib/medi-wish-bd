package bd.mediwish.storage;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.LinkOption;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.NoSuchFileException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Optional;
import java.util.regex.Pattern;

public final class LocalObjectStorage implements ObjectStorage {
    private static final String UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    private static final Pattern KEY = Pattern.compile("products/" + UUID_PATTERN + "/" + UUID_PATTERN + "\\.(jpg|png)");
    private final Path root;
    private final String namespace;

    public LocalObjectStorage(Path root, String namespace) { this.root = root; this.namespace = namespace; }
    private Path path(String key) {
        if (key == null || !KEY.matcher(key).matches()) throw new IllegalArgumentException("Invalid object key");
        Path base = root.resolve(namespace).toAbsolutePath().normalize();
        Path target = base.resolve(key).normalize();
        if (!target.startsWith(base)) throw new IllegalArgumentException("Invalid object key");
        for (Path ancestor = target; ancestor != null; ancestor = ancestor.getParent()) {
            if (Files.isSymbolicLink(ancestor)) throw new StorageUnavailableException();
        }
        return target;
    }
    @Override public PutResult put(String key, byte[] bytes) {
        Path target = path(key), temporary = null;
        try {
            Files.createDirectories(target.getParent());
            path(key);
            temporary = Files.createTempFile(target.getParent(), ".image-", ".tmp");
            Files.write(temporary, bytes);
            try {
                Files.move(temporary, target);
                return PutResult.CREATED;
            } catch (FileAlreadyExistsException present) {
                path(key);
                try (var input = Files.newInputStream(target, LinkOption.NOFOLLOW_LINKS)) {
                    if (MessageDigest.isEqual(digest(input.readAllBytes()), digest(bytes))) return PutResult.ALREADY_PRESENT;
                }
                throw new ObjectConflictException();
            }
        } catch (IOException error) { throw new StorageUnavailableException(); }
        finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); } catch (IOException ignored) { /* The original operation's outcome is preserved. */ }
            }
        }
    }
    @Override public Optional<StoredObject> get(String key) {
        Path target = path(key);
        try {
            var stream = Files.newInputStream(target, LinkOption.NOFOLLOW_LINKS);
            try { return Optional.of(new StoredObject(Files.size(target), stream)); }
            catch (IOException error) { stream.close(); throw error; }
        } catch (NoSuchFileException absent) { return Optional.empty(); }
        catch (IOException error) { throw new StorageUnavailableException(); }
    }
    @Override public void delete(String key) {
        try { Files.deleteIfExists(path(key)); }
        catch (IOException error) { throw new StorageUnavailableException(); }
    }
    private static byte[] digest(byte[] bytes) {
        try { return MessageDigest.getInstance("SHA-256").digest(bytes); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
