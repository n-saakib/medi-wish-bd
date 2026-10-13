package bd.mediwish.catalog;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static bd.mediwish.testsupport.ApiAssertions.*;
import static org.assertj.core.api.Assertions.assertThat;

/** Product image acceptance through real HTTP, PostgreSQL and run-owned filesystem storage. */
@Tag("integration")
@Tag("security")
class ProductImagesIT {
    @Test void durableUploadReplayAltOrderReplacementAndRemovalKeepPublicIdentitySafe() throws Exception {
        try (var images = ProductImageTestApi.start()) {
            var api = images.catalog; var actor = api.actor("MODERATOR");
            var category = api.category(actor, "Images " + UUID.randomUUID());
            String product = (String) api.medicine(actor, UUID.fromString((String) category.get("id"))).get("id");
            var firstId = UUID.randomUUID(); byte[] png = ProductImageTestApi.png(3, 2);
            var uploaded = images.upload(actor, product, firstId, png, "image/png", "synthetic.png", Map.of("altText", "Front"));
            assertThat(uploaded.statusCode()).isEqualTo(201); var first = json(uploaded);
            assertThat(first).containsEntry("width", 3).containsEntry("height", 2).containsEntry("altText", "Front").containsEntry("position", 0);
            assertThat(first.keySet()).containsExactlyInAnyOrder("id", "url", "contentType", "width", "height", "byteSize", "altText", "position", "version", "createdAt");
            var replay = images.upload(actor, product, firstId, png, "image/png", "different-name.png", Map.of("altText", "Front"));
            assertThat(replay.statusCode()).isEqualTo(200); assertThat(json(replay)).isEqualTo(first);
            assertError(images.upload(actor, product, firstId, png, "image/png", "synthetic.png", Map.of("altText", "Different")),409,"ID_CONFLICT");
            String url = (String) first.get("url");
            var publicImage = images.publicImage("GET",url);
            assertThat(publicImage.statusCode()).isEqualTo(200);
            assertThat(publicImage.body()).isEqualTo(Files.readAllBytes(images.object(product,firstId,"png")));
            assertThat(publicImage.headers().allValues("Cache-Control")).containsExactly("public, max-age=60");
            assertThat(publicImage.headers().firstValue("Content-Disposition")).hasValue("inline");
            assertThat(publicImage.headers().firstValue("X-Content-Type-Options")).hasValue("nosniff");
            var head = images.publicImage("HEAD",url);
            assertThat(head.statusCode()).isEqualTo(200); assertThat(head.body()).isEmpty();
            assertThat(head.headers().firstValue("Content-Length")).hasValue(String.valueOf(publicImage.body().length));
            assertThat(images.publicImage("GET",url.replace(".png",".jpg")).statusCode()).isEqualTo(404);
            var secondId = UUID.randomUUID();
            assertThat(images.upload(actor,product,secondId,png,"image/png","synthetic.png",Map.of()).statusCode()).isEqualTo(201);
            String base = "/api/staff/products/" + product;
            assertThat(api.send("PUT",base+"/images/"+firstId,actor,Map.of("altText","Side","version",0)).statusCode()).isEqualTo(200);
            assertError(api.send("PUT",base+"/images/"+firstId,actor,Map.of("altText","Back","version",0)),409,"STALE_UPDATE");
            var order = api.send("PUT",base+"/image-order",actor,Map.of("imageIds",List.of(secondId,firstId),"expectedImageIds",List.of(firstId,secondId)));
            assertThat(order.statusCode()).isEqualTo(200);
            api.application().restart();
            assertThat(json(api.send("GET",images.path(product),actor,null))).isEqualTo(json(order));
            assertThat(images.publicImage("GET",url).body()).isEqualTo(publicImage.body());
            var replacement = UUID.randomUUID();
            assertThat(images.upload(actor,product,replacement,png,"image/png","synthetic.png",Map.of("replaces",firstId.toString())).statusCode()).isEqualTo(201);
            assertThat(Files.exists(images.object(product,firstId,"png"))).isFalse();
            assertThat(images.publicImage("GET",url).statusCode()).isEqualTo(404);
            assertError(images.upload(actor,product,firstId,png,"image/png","synthetic.png",Map.of()),409,"ID_CONFLICT");
            assertThat(api.send("DELETE",images.path(product)+"/"+replacement,actor,null).statusCode()).isEqualTo(204);
            assertThat(Files.exists(images.object(product,replacement,"png"))).isFalse();
            assertThat(images.files()).isEqualTo(1);
        }
    }
    @Test void invalidUploadsAndCrossProductAttachmentWriteNeitherRowsNorObjects() throws Exception {
        try (var images = ProductImageTestApi.start()) {
            var api=images.catalog; var actor=api.actor("ADMIN");
            var category=api.category(actor,"Invalid images "+UUID.randomUUID()); var categoryId=UUID.fromString((String)category.get("id"));
            String product=(String)api.medicine(actor,categoryId).get("id"); byte[] png=ProductImageTestApi.png(2,2);
            for (byte[] bytes : new byte[][]{new byte[0],new byte[3_145_729],new byte[]{1,2,3},Arrays.copyOf(png,20),ProductImageTestApi.png(4097,1)})
                assertError(images.upload(actor,product,UUID.randomUUID(),bytes,"image/png","synthetic.png",Map.of()),400,"IMAGE_INVALID");
            assertError(images.upload(actor,product,UUID.randomUUID(),png,"image/jpeg","synthetic.jpg",Map.of()),400,"IMAGE_INVALID");
            assertError(images.upload(actor,product,UUID.randomUUID(),png,"image/png","synthetic.png",Map.of("url","http://127.0.0.1/private")),400,"INVALID_REQUEST");
            assertError(images.upload(actor,product,UUID.randomUUID(),png,"image/png",null,Map.of()),400,"INVALID_REQUEST");
            assertError(images.upload(actor,product,UUID.randomUUID(),new byte[2_621_440],"image/png",null,Map.of()),400,"IMAGE_INVALID");
            assertError(images.upload(actor,product,UUID.randomUUID(),png,"image/png","synthetic.png",Map.of("altText","x".repeat(161))),400,"INVALID_REQUEST");
            assertError(api.send("POST",images.path(product),actor,Map.of()),415,"INVALID_REQUEST");
            assertThat(api.database().single("SELECT count(*) FROM product_images",Long.class)).isZero(); assertThat(images.files()).isZero();
            var imageId=UUID.randomUUID(); assertThat(images.upload(actor,product,imageId,png,"image/png","synthetic.png",Map.of()).statusCode()).isEqualTo(201);
            String other=(String)api.medicine(actor,categoryId).get("id");
            assertError(images.upload(actor,other,UUID.randomUUID(),png,"image/png","synthetic.png",Map.of("replaces",imageId.toString())),404,"NOT_FOUND");
            assertError(api.send("DELETE",images.path(other)+"/"+imageId,actor,null),404,"NOT_FOUND");
            assertThat(images.files()).isEqualTo(1);
        }
    }
    @Test void actorMatrixRejectsBeforeMultipartParsingAndLargeBodiesHaveReadableAnswers() throws Exception {
        try (var images=ProductImageTestApi.start()) {
            var api=images.catalog; String product=UUID.randomUUID().toString(); var imageId=UUID.randomUUID();
            byte[] large=Arrays.copyOf(ProductImageTestApi.png(2,2),2_621_440);
            var anonymous=images.upload(null,product,imageId,large,"image/png","synthetic.png",Map.of());
            assertError(anonymous,401,"AUTHENTICATION_REQUIRED"); assertThat(anonymous.headers().firstValue("WWW-Authenticate")).hasValue("Bearer");
            assertError(api.send("GET",images.path(product),(CatalogTestApi.Actor)null,null),401,"AUTHENTICATION_REQUIRED");
            assertError(api.send("PUT",images.path(product)+"/"+imageId,(CatalogTestApi.Actor)null,"PRIVATE_INVALID_BODY"),401,"AUTHENTICATION_REQUIRED");
            assertError(api.send("PUT","/api/staff/products/"+product+"/image-order",(CatalogTestApi.Actor)null,"PRIVATE_INVALID_BODY"),401,"AUTHENTICATION_REQUIRED");
            assertError(api.send("DELETE",images.path(product)+"/"+imageId,(CatalogTestApi.Actor)null,null),401,"AUTHENTICATION_REQUIRED");
            for (String role : new String[]{"CUSTOMER","DELIVERY_PERSON","RESTRICTED_ADMIN"}) {
                var actor=api.actor(role); String code=role.equals("RESTRICTED_ADMIN")?"MFA_REQUIRED":"ACCESS_DENIED";
                assertError(images.upload(actor,product,imageId,large,"image/png","synthetic.png",Map.of()),403,code);
                assertError(api.send("GET",images.path(product),actor,null),403,code);
                assertError(api.send("PUT",images.path(product)+"/"+imageId,actor,"PRIVATE_INVALID_BODY"),403,code);
                assertError(api.send("PUT","/api/staff/products/"+product+"/image-order",actor,"PRIVATE_INVALID_BODY"),403,code);
                assertError(api.send("DELETE",images.path(product)+"/"+imageId,actor,null),403,code);
            }
            var invalid=new CatalogTestApi.Actor(UUID.randomUUID(),"synthetic","invalid-token","CUSTOMER");
            assertError(images.upload(invalid,product,imageId,large,"image/png","synthetic.png",Map.of()),401,"AUTHENTICATION_REQUIRED");
            assertThat(images.files()).isZero();
        }
    }
    @Test void eightImageLimitAllowsReplacementButRejectsAppendWithoutWritingObjects() throws Exception {
        try (var images=ProductImageTestApi.start()) {
            var api=images.catalog; var actor=api.actor("ADMIN");
            var category=api.category(actor,"Limit "+UUID.randomUUID());
            String product=(String)api.medicine(actor,UUID.fromString((String)category.get("id"))).get("id");
            byte[] png=ProductImageTestApi.png(2,2); var first=UUID.randomUUID();
            for (int index=0;index<8;index++) {
                var id=index==0?first:UUID.randomUUID();
                assertThat(images.upload(actor,product,id,png,"image/png","synthetic.png",Map.of()).statusCode()).isEqualTo(201);
            }
            assertError(images.upload(actor,product,UUID.randomUUID(),png,"image/png","synthetic.png",Map.of()),409,"IMAGE_LIMIT_REACHED");
            assertThat(images.files()).isEqualTo(8);
            var replacement=UUID.randomUUID();
            assertThat(images.upload(actor,product,replacement,png,"image/png","synthetic.png",Map.of("replaces",first.toString())).statusCode()).isEqualTo(201);
            assertThat(images.files()).isEqualTo(8);
            assertThat(api.database().single("SELECT count(*) FROM product_images",Long.class)).isEqualTo(8);
            var missing=UUID.randomUUID();
            assertError(images.upload(actor,product,missing,png,"image/png","synthetic.png",Map.of("replaces",UUID.randomUUID().toString())),404,"NOT_FOUND");
            assertThat(Files.exists(images.object(product,missing,"png"))).isFalse();
        }
    }
    @Test void storageOutageIsBoundedAndDoesNotPersistAnImage() throws Exception {
        try (var images=ProductImageTestApi.start()) {
            var api=images.catalog; var actor=api.actor("ADMIN");
            var category=api.category(actor,"Outage "+UUID.randomUUID()); String product=(String)api.medicine(actor,UUID.fromString((String)category.get("id"))).get("id");
            var id=UUID.randomUUID(); var object=images.object(product,id,"png");
            Files.createDirectories(object.getParent().getParent()); Files.writeString(object.getParent(),"run-owned obstruction");
            try {
                assertError(images.upload(actor,product,id,ProductImageTestApi.png(2,2),"image/png","synthetic.png",Map.of()),503,"STORAGE_UNAVAILABLE");
                assertThat(api.database().single("SELECT count(*) FROM product_images",Long.class)).isZero();
            } finally { Files.deleteIfExists(object.getParent()); }
        }
    }
}