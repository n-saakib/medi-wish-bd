package bd.mediwish.catalog;

import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import tools.jackson.databind.JsonNode;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Strict image request shapes; storage names and remote URLs are never accepted. */
final class ProductImageRequests {
    private ProductImageRequests() {}
    record Upload(UUID id, MultipartFile file, String altText, UUID replaces) {}
    record Alt(String altText, long version) {}
    record Order(List<UUID> imageIds, List<UUID> expectedImageIds) {}
    static Upload upload(MultipartHttpServletRequest request) {
        var files = request.getMultiFileMap(); var fields = request.getParameterMap();
        if (files.size() != 1 || !files.containsKey("file") || files.get("file").size() != 1
                || fields.keySet().stream().anyMatch(key -> !Set.of("id", "altText", "replaces").contains(key))
                || fields.values().stream().anyMatch(values -> values.length != 1)) throw new InvalidCatalogException("parts");
        var partFields = new java.util.HashSet<String>();
        try {
            for (var part : request.getParts()) {
                if (part.getSubmittedFileName() == null) {
                    if (!Set.of("id", "altText", "replaces").contains(part.getName()) || !partFields.add(part.getName()))
                        throw new InvalidCatalogException("parts");
                } else if (!"file".equals(part.getName())) throw new InvalidCatalogException("parts");
            }
        } catch (java.io.IOException | jakarta.servlet.ServletException failure) {
            throw new org.springframework.web.multipart.MultipartException("Invalid multipart request", failure);
        }
        // Servlet parameters merge query strings and form fields; only actual body parts may supply commands.
        if (!partFields.equals(fields.keySet())) throw new InvalidCatalogException("parts");
        MultipartFile file = files.get("file").getFirst();
        if (file.getOriginalFilename() == null || file.getOriginalFilename().isEmpty()) throw new InvalidCatalogException("file");
        String id = request.getParameter("id"), replaces = request.getParameter("replaces");
        return new Upload(CatalogRequests.uuid(id), file, request.getParameter("altText"),
                replaces == null ? null : CatalogRequests.uuid(replaces));
    }
    static Alt alt(JsonNode body) {
        CatalogRequests.object(body, Set.of("altText", "version"));
        if (!body.has("altText")) throw new InvalidCatalogException("altText");
        return new Alt(CatalogRequests.string(body, "altText", false), CatalogRequests.version(body));
    }
    static Order order(JsonNode body) {
        CatalogRequests.object(body, Set.of("imageIds", "expectedImageIds"));
        var ids = ids(body.get("imageIds")); var expected = ids(body.get("expectedImageIds"));
        if (!Set.copyOf(ids).equals(Set.copyOf(expected))) throw new InvalidCatalogException("imageIds");
        return new Order(ids, expected);
    }
    private static List<UUID> ids(JsonNode node) {
        if (node == null || !node.isArray() || node.size() > 8) throw new InvalidCatalogException("imageIds");
        var ids = new java.util.ArrayList<UUID>();
        for (JsonNode value : node) {
            if (!value.isString()) throw new InvalidCatalogException("imageIds");
            UUID id = CatalogRequests.uuid(value.stringValue());
            if (ids.contains(id)) throw new InvalidCatalogException("imageIds");
            ids.add(id);
        }
        return List.copyOf(ids);
    }
}
