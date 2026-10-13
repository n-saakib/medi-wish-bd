package bd.mediwish.catalog;

import bd.mediwish.storage.StorageProperties;
import bd.mediwish.testsupport.TestApplication;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static bd.mediwish.testsupport.ApiAssertions.*;
import static org.assertj.core.api.Assertions.assertThat;

/** Real HTTP/DB regression for ownership, local namespace confinement and sensitive metadata. */
@Tag("integration")
@Tag("regression")
@Tag("security")
@ExtendWith(OutputCaptureExtension.class)
class ProductImageRegressionIT {
    @Test void crossProductCommandsAndRemovalNeverTouchAnotherProductsImages() throws Exception {
        try (var images = ProductImageTestApi.start()) {
            var api = images.catalog; var actor = api.actor("MODERATOR");
            UUID category = UUID.fromString((String) api.category(actor, "Ownership " + UUID.randomUUID()).get("id"));
            String a = (String) api.medicine(actor, category).get("id");
            String b = (String) api.medicine(actor, category).get("id");
            UUID imageA = UUID.randomUUID(), imageB = UUID.randomUUID();
            byte[] png = ProductImageTestApi.png(3, 2);
            assertThat(images.upload(actor,a,imageA,png,"image/png","synthetic.png",Map.of()).statusCode()).isEqualTo(201);
            assertThat(images.upload(actor,b,imageB,png,"image/png","synthetic.png",Map.of()).statusCode()).isEqualTo(201);
            var beforeA = json(api.send("GET",images.path(a),actor,null));
            var beforeB = json(api.send("GET",images.path(b),actor,null));
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(images.object(a,imageA,"png")));
            assertError(images.upload(actor,b,UUID.randomUUID(),png,"image/png","synthetic.png",Map.of("replaces",imageA.toString())),404,"NOT_FOUND");
            assertError(api.send("PUT",images.path(b)+"/"+imageA,actor,Map.of("altText","Other","version",0)),404,"NOT_FOUND");
            assertError(api.send("DELETE",images.path(b)+"/"+imageA,actor,null),404,"NOT_FOUND");
            assertError(api.send("PUT","/api/staff/products/"+b+"/image-order",actor,Map.of("imageIds",List.of(imageA),"expectedImageIds",List.of(imageA))),409,"STALE_UPDATE");
            assertThat(json(api.send("GET",images.path(a),actor,null))).isEqualTo(beforeA);
            assertThat(json(api.send("GET",images.path(b),actor,null))).isEqualTo(beforeB);
            UUID replacement = UUID.randomUUID();
            assertThat(images.upload(actor,b,replacement,png,"image/png","synthetic.png",Map.of("replaces",imageB.toString())).statusCode()).isEqualTo(201);
            assertThat(api.send("DELETE",images.path(b)+"/"+replacement,actor,null).statusCode()).isEqualTo(204);
            assertThat(json(api.send("GET",images.path(a),actor,null))).isEqualTo(beforeA);
            assertThat(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(images.object(a,imageA,"png")))).isEqualTo(hash);
            assertThat(images.files()).isOne();
        }
    }

    @Test void anotherNamespaceAndPlantedProductionObjectAreNeverFallbackSources() throws Exception {
        try (var images = ProductImageTestApi.start(); var client = HttpClient.newHttpClient()) {
            var api = images.catalog; var actor = api.actor("ADMIN");
            UUID category = UUID.fromString((String) api.category(actor,"Isolation "+UUID.randomUUID()).get("id"));
            String product = (String) api.medicine(actor,category).get("id"); UUID id = UUID.randomUUID();
            var uploaded = images.upload(actor,product,id,ProductImageTestApi.png(2,2),"image/png","synthetic.png",Map.of());
            assertThat(uploaded.statusCode()).isEqualTo(201); String url = (String) json(uploaded).get("url");
            var storage = api.application().bean(StorageProperties.class);
            String namespace = "test-it-"+UUID.randomUUID().toString().replace("-", "");
            Path secondRoot = Path.of(storage.localRoot(),namespace);
            Path plantedRoot = Path.of(storage.localRoot(),"prod-"+UUID.randomUUID().toString().replace("-", "").substring(0,12));
            try {
                var properties = new HashMap<>(api.database().applicationProperties());
                properties.put("app.storage.namespace",namespace);
                try (var second = TestApplication.start(properties)) {
                    var reply = client.send(HttpRequest.newBuilder(second.uri(url)).GET().build(),HttpResponse.BodyHandlers.ofByteArray());
                    assertThat(reply.statusCode()).isEqualTo(404);
                    assertThat(Files.exists(secondRoot)).isFalse();
                }
                Path planted = plantedRoot.resolve("products").resolve(product).resolve(id+".png");
                Files.createDirectories(planted.getParent()); Files.writeString(planted,"PRIVATE_PRODUCTION_SENTINEL");
                Files.delete(images.object(product,id,"png"));
                var absent = images.publicImage("GET",url);
                assertThat(absent.statusCode()).isEqualTo(404);
                assertThat(new String(absent.body(),java.nio.charset.StandardCharsets.UTF_8)).doesNotContain("PRIVATE_PRODUCTION_SENTINEL");
                assertThat(api.database().single("SELECT count(*) FROM product_images WHERE id = ?",Long.class,id)).isOne();
                assertThat(Files.readString(planted)).isEqualTo("PRIVATE_PRODUCTION_SENTINEL");
            } finally { removeTree(secondRoot); removeTree(plantedRoot); }
        }
    }

    @Test void logsAndResponsesOmitPrivateUploadDetails(CapturedOutput output) throws Exception {
        try (var images = ProductImageTestApi.start()) {
            var api=images.catalog; var actor=api.actor("ADMIN");
            UUID category=UUID.fromString((String)api.category(actor,"Privacy "+UUID.randomUUID()).get("id"));
            String product=(String)api.medicine(actor,category).get("id");
            String filename="synthetic-person-01700000000.png", alt="PRIVATE_ALT_SENTINEL_01700000000";
            byte[] bytes=ProductImageTestApi.png(2,2);
            var upload=images.upload(actor,product,UUID.randomUUID(),bytes,"image/png",filename,Map.of("altText",alt));
            assertThat(upload.statusCode()).isEqualTo(201);
            var list=api.send("GET",images.path(product),actor,null);
            for (var response : List.of(upload,list)) assertThat(response.body()).doesNotContain("object_key","products/","sha256",filename);
            assertThat(output.getAll()).doesNotContain(actor.token(),filename,alt,java.util.Base64.getEncoder().encodeToString(bytes));
        }
    }

    @Test void deletionFailureAndRollbackCompensationRemainBounded(CapturedOutput output) throws Exception {
        try (var images=ProductImageTestApi.start(); var client=HttpClient.newHttpClient()) {
            var api=images.catalog; var actor=api.actor("ADMIN");
            UUID category=UUID.fromString((String)api.category(actor,"Faults "+UUID.randomUUID()).get("id"));
            String product=(String)api.medicine(actor,category).get("id"); byte[] png=ProductImageTestApi.png(2,2);
            UUID removed=UUID.randomUUID();
            var uploaded=images.upload(actor,product,removed,png,"image/png","synthetic.png",Map.of());
            assertThat(uploaded.statusCode()).isEqualTo(201);
            try (var failing=TestApplication.start(api.database().applicationProperties(),FaultStorage.class)) {
                var faults=failing.bean(Faults.class); faults.failDelete=true;
                var deletion=failing.send("DELETE",images.path(product)+"/"+removed,Map.of("Authorization","Bearer "+actor.token()),null);
                assertThat(deletion.statusCode()).isEqualTo(204);
                assertThat(images.publicImage("GET",(String)json(uploaded).get("url")).statusCode()).isEqualTo(404);
                assertThat(Files.exists(images.object(product,removed,"png"))).isTrue();
                assertThat(api.database().single("SELECT count(*) FROM retired_product_image_ids WHERE id = ?",Long.class,removed)).isOne();
                for (boolean deleteFailure : new boolean[]{false,true}) {
                    faults.failDelete=deleteFailure; faults.rollback=true; UUID id=UUID.randomUUID();
                    var original=images.uploadRequest(actor,product,id,png,"image/png","synthetic-person-01700000000.png",Map.of("altText","PRIVATE_FAULT_ALT"));
                    var request=HttpRequest.newBuilder(failing.uri(images.path(product))).POST(original.bodyPublisher().orElseThrow());
                    original.headers().map().forEach((name,values)->values.forEach(value->request.header(name,value)));
                    var reply=client.send(request.build(),HttpResponse.BodyHandlers.ofString());
                    assertError(reply,503,"STORAGE_UNAVAILABLE");
                    assertThat(api.database().single("SELECT count(*) FROM product_images WHERE id = ?",Long.class,id)).isZero();
                    assertThat(Files.exists(images.object(product,id,"png"))).isEqualTo(deleteFailure);
                    assertThat(reply.body()).doesNotContain("PRIVATE_FAULT_ALT","products/","object_key","sha256");
                }
                assertThat(output.getAll()).contains("StorageUnavailableException").doesNotContain("PRIVATE_FAULT_DETAIL","PRIVATE_FAULT_ALT",actor.token(),"synthetic-person-01700000000.png");
            }
        }
    }

    static final class Faults { volatile boolean rollback; volatile boolean failDelete; }
    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods=false)
    static class FaultStorage {
        @org.springframework.context.annotation.Bean Faults faults() { return new Faults(); }
        @org.springframework.context.annotation.Bean static org.springframework.beans.factory.config.BeanPostProcessor faultStorage(Faults faults) {
            return new org.springframework.beans.factory.config.BeanPostProcessor() {
                @Override public Object postProcessAfterInitialization(Object bean,String name) {
                    if (!(bean instanceof bd.mediwish.storage.ObjectStorage delegate)) return bean;
                    return new bd.mediwish.storage.ObjectStorage() {
                        @Override public PutResult put(String key,byte[] bytes) {
                            var result=delegate.put(key,bytes);
                            if (faults.rollback) {
                                faults.rollback=false;
                                org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(new org.springframework.transaction.support.TransactionSynchronization() {
                                    @Override public void beforeCommit(boolean readOnly) { throw new bd.mediwish.storage.StorageUnavailableException(); }
                                });
                            }
                            return result;
                        }
                        @Override public java.util.Optional<StoredObject> get(String key) { return delegate.get(key); }
                        @Override public void delete(String key) {
                            if (faults.failDelete) {
                                var failure=new bd.mediwish.storage.StorageUnavailableException();
                                failure.initCause(new IllegalStateException("PRIVATE_FAULT_DETAIL "+key));
                                throw failure;
                            }
                            delegate.delete(key);
                        }
                    };
                }
            };
        }
    }
    private static void removeTree(Path root) throws Exception {
        if (!Files.exists(root)) return;
        try (var paths=Files.walk(root)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        }
    }
}
