package bd.mediwish.catalog;

import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProductImageRepository extends JpaRepository<ProductImage, UUID> {
    List<ProductImage> findByProductIdOrderByDisplayOrder(UUID productId);
    Optional<ProductImage> findByIdAndProductId(UUID id, UUID productId);
    long countByProductId(UUID productId);
    @Query(value="select 1 from pg_advisory_xact_lock(hashtextextended(cast(:id as text), 15))",nativeQuery=true)
    int claimIdentity(@Param("id") UUID id);
    boolean existsByObjectKey(String key);
    @Modifying
    @Query(value="insert into product_images (id,product_id,object_key,content_type,byte_size,width,height,sha256,alt_text,display_order,version,created_at,updated_at,created_by,updated_by) values (:id,:product,:key,:type,:size,:width,:height,:sha,:alt,:position,0,:now,:now,:actor,:actor) on conflict (id) do nothing", nativeQuery=true)
    int insertIfAbsent(@Param("id") UUID id, @Param("product") UUID product, @Param("key") String key,
        @Param("type") String type, @Param("size") int size, @Param("width") int width,
        @Param("height") int height, @Param("sha") String sha, @Param("alt") String alt,
        @Param("position") int position, @Param("now") Instant now, @Param("actor") UUID actor);
    @Modifying
    @Query(value="delete from product_images where id=:id and product_id=:product",nativeQuery=true)
    int deleteByIdAndProductId(@Param("id") UUID id,@Param("product") UUID product);
    @Modifying
    @Query(value="update product_images set display_order=display_order-1 where product_id=:product and display_order>:position",nativeQuery=true)
    int shiftAfter(@Param("product") UUID product,@Param("position") int position);
    @Modifying
    @Query(value="insert into retired_product_image_ids (id,retired_at) values (:id,:now) on conflict (id) do nothing",nativeQuery=true)
    int retire(@Param("id") UUID id,@Param("now") Instant now);
    @Query(value="select exists(select 1 from retired_product_image_ids where id=:id)",nativeQuery=true)
    boolean isRetired(@Param("id") UUID id);
    @Modifying
    @Query(value="set constraints uk_product_images_order immediate",nativeQuery=true)
    void checkOrderNow();
}
