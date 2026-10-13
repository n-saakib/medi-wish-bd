package bd.mediwish.catalog;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.sql.Connection;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static bd.mediwish.testsupport.ApiAssertions.*;
import static org.assertj.core.api.Assertions.assertThat;

/** Real PostgreSQL-observed command overlap; no sleeps or assumed request scheduling. */
@Tag("integration")
@Tag("regression")
class ConcurrentProductImageIT {
    @Test void finalSlotRacingUploadsHaveOneWinnerAndNoLoserObject() throws Exception {
        try (var images=ProductImageTestApi.start(12)) {
            var api=images.catalog; var actor=api.actor("MODERATOR"); String product=product(api,actor);
            fill(images,actor,product,7); UUID one=UUID.randomUUID(),two=UUID.randomUUID(); byte[] png=ProductImageTestApi.png(2,2);
            var replies=raceUnderLock(api,product,
                    ()->images.upload(actor,product,one,png,"image/png","synthetic.png",Map.of()),
                    ()->images.upload(actor,product,two,png,"image/png","synthetic.png",Map.of()));
            assertThat(statuses(replies)).containsExactlyInAnyOrder(201,409);
            assertError(replies.stream().filter(r->r.statusCode()==409).findFirst().orElseThrow(),409,"IMAGE_LIMIT_REACHED");
            UUID loser=replies.get(0).statusCode()==409?one:two;
            assertThat(Files.exists(images.object(product,loser,"png"))).isFalse();
            assertThat(images.files()).isEqualTo(8); assertCount(api,product,8);
        }
    }

    @Test void sameIdRacesReplayBothWithoutSlotsAndAtTheLastSlot() throws Exception {
        try (var images=ProductImageTestApi.start(12)) {
            var api=images.catalog; var actor=api.actor("ADMIN"); byte[] png=ProductImageTestApi.png(2,2);
            for (int prior : new int[]{0,7}) {
                String product=product(api,actor); fill(images,actor,product,prior); UUID id=UUID.randomUUID();
                Callable<HttpResponse<String>> upload=()->images.upload(actor,product,id,png,"image/png","synthetic.png",Map.of("altText","Same intent"));
                var replies=raceUnderLock(api,product,upload,upload);
                assertThat(statuses(replies)).containsExactlyInAnyOrder(201,200);
                assertThat(json(replies.get(0))).isEqualTo(json(replies.get(1)));
                assertCount(api,product,prior+1);
                assertThat(Files.exists(images.object(product,id,"png"))).isTrue();
                assertThat(images.publicImage("GET",(String)json(replies.get(0)).get("url")).body()).isEqualTo(Files.readAllBytes(images.object(product,id,"png")));
            }
            assertThat(images.files()).isEqualTo(9);
        }
    }

    @Test void staleAltAndReorderRacesHaveOneWinnerAndRemovePreservesContiguousOrder() throws Exception {
        try (var images=ProductImageTestApi.start(12)) {
            var api=images.catalog; var actor=api.actor("ADMIN"); String product=product(api,actor);
            var ids=fill(images,actor,product,3); String path=images.path(product);
            var alt=raceUnderLock(api,product,
                    ()->api.send("PUT",path+"/"+ids.getFirst(),actor,Map.of("altText","One","version",0)),
                    ()->api.send("PUT",path+"/"+ids.getFirst(),actor,Map.of("altText","Two","version",0)));
            assertStale(alt);
            var a=List.of(ids.get(1),ids.get(0),ids.get(2)); var b=List.of(ids.get(2),ids.get(1),ids.get(0));
            var orders=raceUnderLock(api,product,
                    ()->api.send("PUT","/api/staff/products/"+product+"/image-order",actor,Map.of("imageIds",a,"expectedImageIds",ids)),
                    ()->api.send("PUT","/api/staff/products/"+product+"/image-order",actor,Map.of("imageIds",b,"expectedImageIds",ids)));
            assertStale(orders);
            var winning=json(orders.stream().filter(r->r.statusCode()==200).findFirst().orElseThrow());
            assertThat(json(api.send("GET",path,actor,null))).isEqualTo(winning);
            var current=api.database().query("SELECT id FROM product_images WHERE product_id = ? ORDER BY display_order",r->r.getObject(1,UUID.class),UUID.fromString(product));
            var reversed=current.reversed();
            var removal=raceUnderLock(api,product,
                    ()->api.send("DELETE",path+"/"+current.getFirst(),actor,null),
                    ()->api.send("PUT","/api/staff/products/"+product+"/image-order",actor,Map.of("imageIds",reversed,"expectedImageIds",current)));
            assertThat(removal.get(0).statusCode()).isEqualTo(204);
            assertThat(removal.get(1).statusCode()).isIn(200,409);
            if (removal.get(1).statusCode()==409) assertError(removal.get(1),409,"STALE_UPDATE");
            assertThat(api.database().query("SELECT display_order FROM product_images WHERE product_id = ? ORDER BY display_order",r->r.getInt(1),UUID.fromString(product))).containsExactly(0,1);
            assertCount(api,product,2);
        }
    }

    @Test void cancelledResponseAfterServerQueuesStillCommitsAndRetryReturnsReplay() throws Exception {
        try (var images=ProductImageTestApi.start(12); var client=HttpClient.newHttpClient()) {
            var api=images.catalog; var actor=api.actor("ADMIN"); String product=product(api,actor); UUID id=UUID.randomUUID();
            byte[] png=ProductImageTestApi.png(2,2);
            try (Connection blocker=api.database().connect()) {
                blocker.setAutoCommit(false); int pid=lock(blocker,product);
                var pending=client.sendAsync(images.uploadRequest(actor,product,id,png,"image/png","synthetic.png",Map.of("altText","Lost response")),HttpResponse.BodyHandlers.ofString());
                try { awaitBlocked(api,pid,1); assertThat(pending.cancel(true)).isTrue(); }
                finally { blocker.rollback(); }
            }
            // Observe the server commit, rather than racing an early retry into a fresh creation.
            long deadline=System.nanoTime()+Duration.ofSeconds(8).toNanos();
            while (api.database().single("SELECT count(*) FROM product_images WHERE id = ?",Long.class,id)==0 && System.nanoTime()<deadline) Thread.yield();
            assertCount(api,product,1);
            var replay=images.upload(actor,product,id,png,"image/png","synthetic.png",Map.of("altText","Lost response"));
            assertThat(replay.statusCode()).isEqualTo(200);
            var listed=json(api.send("GET",images.path(product),actor,null));
            assertThat(listed.get("images")).isEqualTo(List.of(json(replay)));
            assertThat(images.files()).isOne();
        }
    }

    @Test void restartAdoptsOnlyMatchingOrphanBytesWithoutOverwritingThem() throws Exception {
        try (var images=ProductImageTestApi.start(12)) {
            var api=images.catalog; var actor=api.actor("ADMIN"); String product=product(api,actor); UUID id=UUID.randomUUID();
            byte[] input=ProductImageTestApi.png(3,2);
            byte[] encoded=api.application().bean(ProductImageInspector.class).inspect(input,"image/png","synthetic.png").bytes();
            var object=images.object(product,id,"png"); Files.createDirectories(object.getParent()); Files.write(object,encoded);
            assertCount(api,product,0); api.application().restart();
            var adopted=images.upload(actor,product,id,input,"image/png","synthetic.png",Map.of());
            assertThat(adopted.statusCode()).isEqualTo(201); assertCount(api,product,1); assertThat(images.files()).isOne();
            assertThat(images.publicImage("GET",(String)json(adopted).get("url")).body()).isEqualTo(encoded);
            UUID conflicting=UUID.randomUUID(); var conflictObject=images.object(product,conflicting,"png"); Files.writeString(conflictObject,"PRIVATE_ORPHAN_BYTES");
            assertError(images.upload(actor,product,conflicting,input,"image/png","synthetic.png",Map.of()),409,"ID_CONFLICT");
            assertThat(Files.readString(conflictObject)).isEqualTo("PRIVATE_ORPHAN_BYTES"); assertCount(api,product,1);
        }
    }

    private static String product(CatalogTestApi api,CatalogTestApi.Actor actor) throws Exception {
        UUID category=UUID.fromString((String)api.category(actor,"Concurrency "+UUID.randomUUID()).get("id"));
        return (String)api.medicine(actor,category).get("id");
    }
    private static List<UUID> fill(ProductImageTestApi images,CatalogTestApi.Actor actor,String product,int count) throws Exception {
        var ids=new java.util.ArrayList<UUID>(); byte[] png=ProductImageTestApi.png(2,2);
        for (int i=0;i<count;i++) { UUID id=UUID.randomUUID(); ids.add(id); assertThat(images.upload(actor,product,id,png,"image/png","synthetic.png",Map.of()).statusCode()).isEqualTo(201); }
        return ids;
    }
    private static List<Integer> statuses(List<HttpResponse<String>> replies) { return replies.stream().map(HttpResponse::statusCode).toList(); }
    private static void assertStale(List<HttpResponse<String>> replies) {
        assertThat(statuses(replies)).containsExactlyInAnyOrder(200,409);
        assertError(replies.stream().filter(r->r.statusCode()==409).findFirst().orElseThrow(),409,"STALE_UPDATE");
    }
    private static void assertCount(CatalogTestApi api,String product,int count) throws Exception {
        assertThat(api.database().single("SELECT count(*) FROM product_images WHERE product_id = ?",Long.class,UUID.fromString(product))).isEqualTo(count);
    }
    private static List<HttpResponse<String>> raceUnderLock(CatalogTestApi api,String product,Callable<HttpResponse<String>> first,Callable<HttpResponse<String>> second) throws Exception {
        try (Connection blocker=api.database().connect(); var executor=Executors.newFixedThreadPool(2)) {
            blocker.setAutoCommit(false); int pid=lock(blocker,product); var gate=new CountDownLatch(1);
            var one=executor.submit(()->{gate.await(); return first.call();}); var two=executor.submit(()->{gate.await(); return second.call();});
            try { gate.countDown(); awaitBlocked(api,pid,2); } finally { blocker.rollback(); }
            return List.of(one.get(12,TimeUnit.SECONDS),two.get(12,TimeUnit.SECONDS));
        }
    }
    private static int lock(Connection connection,String product) throws Exception {
        try (var statement=connection.prepareStatement("SELECT 1 FROM products WHERE id = ? FOR UPDATE")) { statement.setObject(1,UUID.fromString(product)); statement.execute(); }
        try (var statement=connection.createStatement(); var result=statement.executeQuery("SELECT pg_backend_pid()")) { result.next(); return result.getInt(1); }
    }
    private static void awaitBlocked(CatalogTestApi api,int pid,int expected) throws Exception {
        long deadline=System.nanoTime()+Duration.ofSeconds(7).toNanos();
        do {
            Long blocked=api.database().single("WITH RECURSIVE blocked_requests(pid) AS (SELECT ?::integer UNION "
                    +"SELECT activity.pid FROM pg_stat_activity activity JOIN blocked_requests blocker ON blocker.pid = ANY(pg_blocking_pids(activity.pid)) "
                    +"WHERE activity.datname = current_database() AND activity.usename = current_user AND activity.wait_event_type = 'Lock') "
                    +"SELECT count(*) FROM blocked_requests WHERE pid <> ?",Long.class,pid,pid);
            if (blocked==expected) return; Thread.yield();
        } while (System.nanoTime()<deadline);
        throw new AssertionError("Expected "+expected+" image requests in the controlled PostgreSQL lock queue");
    }
}
