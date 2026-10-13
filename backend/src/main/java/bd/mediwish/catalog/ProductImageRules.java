package bd.mediwish.catalog;

import bd.mediwish.web.StaleUpdateException;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

final class ProductImageRules {
    static final int MAX_BYTES = 3_145_728;
    static final int MAX_SIDE = 4096;
    static final int MAX_IMAGES = 8;
    private static final Pattern PUBLIC_NAME = Pattern.compile("^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.(jpg|png)$");
    private ProductImageRules() {}

    static String typeForDeclared(String type, String filename) {
        if (filename == null) throw new InvalidImageException();
        String lower = filename.toLowerCase(Locale.ROOT);
        if ("image/png".equals(type) && lower.endsWith(".png")) return type;
        if ("image/jpeg".equals(type) && (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))) return type;
        throw new InvalidImageException();
    }
    static void requireSize(int size) {
        if (size < 1 || size > MAX_BYTES) throw new InvalidImageException();
    }
    static String extension(String type) {
        return switch (type) { case "image/jpeg" -> "jpg"; case "image/png" -> "png"; default -> throw new InvalidImageException(); };
    }
    static String objectKey(UUID productId, UUID imageId, String type) {
        return "products/" + productId + "/" + imageId + "." + extension(type);
    }
    static String publicPath(UUID imageId, String type) { return "/api/public/product-images/" + imageId + "." + extension(type); }
    static Optional<ParsedName> parsePublicFileName(String filename) {
        if (filename == null) return Optional.empty();
        var match = PUBLIC_NAME.matcher(filename);
        return match.matches() ? Optional.of(new ParsedName(UUID.fromString(match.group(1)), match.group(2))) : Optional.empty();
    }
    static Optional<String> altText(String raw) {
        if (raw == null) return Optional.empty();
        if (raw.chars().anyMatch(Character::isISOControl)) throw new InvalidCatalogException("altText");
        String normalized = raw.trim();
        if (normalized.length() > 160) throw new InvalidCatalogException("altText");
        return normalized.isEmpty() ? Optional.empty() : Optional.of(normalized);
    }
    static void requireOrder(List<UUID> requested, List<UUID> expected, List<UUID> current) {
        if (!validOrder(requested) || !validOrder(expected) || !new HashSet<>(requested).equals(new HashSet<>(expected))) throw new InvalidCatalogException("imageIds");
        if (!expected.equals(current)) throw new StaleUpdateException();
    }
    private static boolean validOrder(List<UUID> ids) { return ids != null && ids.size() <= MAX_IMAGES && ids.stream().noneMatch(java.util.Objects::isNull) && new HashSet<>(ids).size() == ids.size(); }
    record ParsedName(UUID id, String extension) {}
}
