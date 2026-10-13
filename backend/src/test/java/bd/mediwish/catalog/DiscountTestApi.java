package bd.mediwish.catalog;

import bd.mediwish.testsupport.TestApplication;
import bd.mediwish.testsupport.TestDatabase;

import java.net.http.HttpResponse;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Adds controlled discount dates and request fixtures to the existing real catalog/MFA harness. */
final class DiscountTestApi implements AutoCloseable {
    // Earlier than the real auth Clock: End-now timestamps must follow the derived start events.
    static final LocalDate TODAY = LocalDate.of(2020, 1, 15);
    private final CatalogTestApi catalog;

    private DiscountTestApi(CatalogTestApi catalog) { this.catalog = catalog; }

    static DiscountTestApi start() throws Exception { return start(3); }

    static DiscountTestApi start(int socketTimeoutSeconds, Class<?>... extraSources) throws Exception {
        Class<?>[] sources = new Class<?>[extraSources.length + 1];
        sources[0] = MovableDiscountCalendar.class;
        System.arraycopy(extraSources, 0, sources, 1, extraSources.length);
        var catalog = CatalogTestApi.start(socketTimeoutSeconds, sources);
        try {
            var api = new DiscountTestApi(catalog);
            api.today(TODAY);
            return api;
        } catch (Exception failure) {
            catalog.close();
            throw failure;
        }
    }

    TestDatabase database() { return catalog.database(); }
    TestApplication application() { return catalog.application(); }
    void today(LocalDate date) { application().bean(MovableDiscountCalendar.Calendar.class).set(date); }

    void restart(LocalDate date) {
        application().restart();
        today(date); // Restart owns a new calendar bean; no reference to the old bean is retained.
    }

    CatalogTestApi.Actor actor(String role) throws Exception { return catalog.actor(role); }

    HttpResponse<String> send(String method, String path, CatalogTestApi.Actor actor, Object body) throws Exception {
        return catalog.send(method, path, actor, body);
    }

    Map<String, Object> category(CatalogTestApi.Actor actor) throws Exception {
        return catalog.category(actor, "Discount category " + UUID.randomUUID());
    }

    Map<String, Object> product(CatalogTestApi.Actor actor, UUID category) throws Exception {
        return catalog.equipment(actor, category);
    }

    Map<String, Object> activeProduct(CatalogTestApi.Actor actor, UUID category, String price) throws Exception {
        return edit(actor, price(actor, product(actor, category), price), Map.of("active", true));
    }

    Map<String, Object> price(CatalogTestApi.Actor actor, Map<String, Object> product, String price) throws Exception {
        return catalog.price(actor, product, price, null);
    }

    Map<String, Object> edit(CatalogTestApi.Actor actor, Map<String, Object> product, Map<String, Object> changes)
            throws Exception {
        return catalog.edit(actor, product, changes);
    }

    Map<String, Object> get(CatalogTestApi.Actor actor, Object id) throws Exception { return catalog.get(actor, id); }

    Map<String, Object> discount(CatalogTestApi.Actor actor, String targetType, UUID targetId, String kind,
            String value, LocalDate startsOn, LocalDate endsOn) throws Exception {
        return successful(send("POST", "/api/staff/discounts", actor,
                createBody(UUID.randomUUID(), targetType, targetId, kind, value, startsOn, endsOn)), 201);
    }

    Map<String, Object> update(CatalogTestApi.Actor actor, Map<String, Object> discount, Map<String, Object> changes)
            throws Exception {
        return successful(send("PUT", "/api/staff/discounts/" + discount.get("id"), actor,
                updateBody(discount, changes)), 200);
    }

    Map<String, Object> end(CatalogTestApi.Actor actor, Map<String, Object> discount) throws Exception {
        return successful(send("POST", "/api/staff/discounts/" + discount.get("id") + "/end", actor,
                Map.of("version", discount.get("version"))), 200);
    }

    Map<String, Object> list(CatalogTestApi.Actor actor, String status, int size) throws Exception {
        return successful(send("GET", "/api/staff/discounts?status=" + status + "&size=" + size, actor, null), 200);
    }

    static Map<String, Object> createBody(UUID id, String targetType, UUID targetId, String kind,
            String value, LocalDate startsOn, LocalDate endsOn) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", id);
        body.put("targetType", targetType);
        body.put("targetId", targetId);
        body.put("kind", kind);
        body.put("value", value);
        body.put("startsOn", startsOn.toString());
        body.put("endsOn", endsOn == null ? null : endsOn.toString());
        return body;
    }

    static Map<String, Object> updateBody(Map<String, Object> discount, Map<String, Object> changes) {
        Map<String, Object> body = new LinkedHashMap<>();
        for (String key : List.of("kind", "value", "startsOn", "endsOn", "version")) body.put(key, discount.get(key));
        body.putAll(changes);
        return body;
    }

    static UUID id(Map<String, Object> object) { return UUID.fromString((String) object.get("id")); }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(Object value) { return (Map<String, Object>) value; }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> items(Map<String, Object> object, String key) {
        return (List<Map<String, Object>>) object.get(key);
    }

    static Map<String, Object> successful(HttpResponse<String> response, int status) {
        assertThat(response.statusCode()).isEqualTo(status);
        return json(response);
    }

    @Override
    public void close() throws Exception { catalog.close(); }
}
