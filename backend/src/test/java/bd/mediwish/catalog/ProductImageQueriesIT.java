package bd.mediwish.catalog;

import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import java.util.Map;
import java.util.UUID;
import static bd.mediwish.testsupport.ApiAssertions.json;
import static org.assertj.core.api.Assertions.assertThat;

/** Real authenticated HTTP query measurements on isolated PostgreSQL and object storage. */
@Tag("integration")
class ProductImageQueriesIT {
    @Test void listAndUploadStatementCountsStayBoundedAsImagesGrow() throws Exception {
        try(var api=ProductImageTestApi.start()) {
            var admin=api.catalog.actor("ADMIN");
            var category=api.catalog.category(admin,"Image query category");
            var product=api.catalog.equipment(admin,UUID.fromString((String)category.get("id")));
            Object productId=product.get("id");
            byte[] bytes=ProductImageTestApi.png(2,2);
            var statistics=api.catalog.application().bean(EntityManagerFactory.class)
                    .unwrap(SessionFactory.class).getStatistics();
            statistics.setStatisticsEnabled(true);
            api.catalog.send("GET",api.path(productId),admin,null);
            statistics.clear();
            assertThat(api.upload(admin,productId,UUID.randomUUID(),bytes,"image/png","fixture.png",Map.of()).statusCode()).isEqualTo(201);
            long firstUpload=statistics.getPrepareStatementCount();
            statistics.clear();
            var one=api.catalog.send("GET",api.path(productId),admin,null);
            assertThat(one.statusCode()).isEqualTo(200);
            assertThat(json(one).get("images")).asList().hasSize(1);
            long oneList=statistics.getPrepareStatementCount();
            for(int n=1;n<7;n++)
                assertThat(api.upload(admin,productId,UUID.randomUUID(),bytes,"image/png","fixture.png",Map.of()).statusCode()).isEqualTo(201);
            statistics.clear();
            assertThat(api.upload(admin,productId,UUID.randomUUID(),bytes,"image/png","fixture.png",Map.of()).statusCode()).isEqualTo(201);
            long eighthUpload=statistics.getPrepareStatementCount();
            statistics.clear();
            var eight=api.catalog.send("GET",api.path(productId),admin,null);
            assertThat(eight.statusCode()).isEqualTo(200);
            assertThat(json(eight).get("images")).asList().hasSize(8);
            long eightList=statistics.getPrepareStatementCount();
            assertThat(eightList).isPositive().isLessThanOrEqualTo(16).isEqualTo(oneList);
            assertThat(eighthUpload).isPositive().isLessThanOrEqualTo(24).isLessThanOrEqualTo(firstUpload+1);
            // Authentication is included in prepared counts; Hibernate reports HQL keys for the single image collection select.
            long imageSelects=java.util.Arrays.stream(statistics.getQueries())
                    .filter(query->query.contains("FROM ProductImage ") && query.contains("ORDER BY p.displayOrder"))
                    .mapToLong(query->statistics.getQueryStatistics(query).getExecutionCount()).sum();
            assertThat(imageSelects).as("R1 performs exactly one image collection select").isEqualTo(1);
            System.out.printf("T15 SQL counts: list1=%d list8=%d upload1=%d upload8=%d imageCollectionSelects=%d%n",
                    oneList,eightList,firstUpload,eighthUpload,imageSelects);
        }
    }
}
