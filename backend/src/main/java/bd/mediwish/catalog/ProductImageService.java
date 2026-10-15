package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.storage.ObjectStorage;
import bd.mediwish.storage.StorageUnavailableException;
import bd.mediwish.web.StaleUpdateException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.*;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import static bd.mediwish.catalog.ProductImageViews.*;

@Service
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
class ProductImageService {
    private static final Logger LOG=LoggerFactory.getLogger(ProductImageService.class);
    private final ProductRepository products;
    private final ProductImageRepository images;
    private final ObjectStorage storage;
    private final ProductImageInspector inspector;
    private final Clock clock;
    private final TransactionTemplate transaction;
    private final TransactionTemplate read;
    private final Semaphore decoders=new Semaphore(2);
    private final long decodeWaitMillis;
    @org.springframework.beans.factory.annotation.Autowired
    ProductImageService(ProductRepository products, ProductImageRepository images, ObjectStorage storage,
            ProductImageInspector inspector, Clock clock, PlatformTransactionManager manager) {
        this(products,images,storage,inspector,clock,manager,5000);
    }
    ProductImageService(ProductRepository products, ProductImageRepository images, ObjectStorage storage,
            ProductImageInspector inspector, Clock clock, PlatformTransactionManager manager, long decodeWaitMillis) {
        this.products=products; this.images=images; this.storage=storage; this.inspector=inspector; this.clock=clock;
        this.decodeWaitMillis=decodeWaitMillis;
        transaction=new TransactionTemplate(manager); read=new TransactionTemplate(manager); read.setReadOnly(true);
    }
    ImageList list(UUID product, CurrentUser current) {
        CatalogAuthorization.require(current,CatalogArea.CATALOG);
        return read.execute(status -> { requireProduct(product); return listView(product); });
    }
    ImageCreation upload(UUID product, UUID id, byte[] bytes, String type, String filename, String rawAlt,
            UUID replaces, CurrentUser current) {
        CatalogAuthorization.require(current,CatalogArea.CATALOG);
        if (product==null || id==null) throw new InvalidCatalogException("id");
        String alt=ProductImageRules.altText(rawAlt).orElse(null);
        read.executeWithoutResult(status -> requireProduct(product));
        var inspected=inspect(bytes,type,filename);
        var replay=read.execute(status -> replay(product,id,alt,inspected.sha256()));
        if (replay!=null) return replay;
        String key=ProductImageRules.objectKey(product,id,inspected.contentType());
        boolean[] created={false};
        try {
            return transaction.execute(status -> {
                lockProduct(product);
                images.claimIdentity(id);
                var duplicate=replay(product,id,alt,inspected.sha256());
                if (duplicate!=null) return duplicate;
                var replaced=replaces==null ? null : images.findByIdAndProductId(replaces,product)
                    .orElseThrow(CatalogNotFoundException::new);
                long count=images.countByProductId(product);
                if (count-(replaced==null ? 0 : 1)>=ProductImageRules.MAX_IMAGES) throw new ImageLimitReachedException();
                try { created[0]=storage.put(key,inspected.bytes())==ObjectStorage.PutResult.CREATED; }
                catch (bd.mediwish.storage.ObjectConflictException conflict) { throw new IdConflictException(); }
                Instant now=now();
                int inserted=images.insertIfAbsent(id,product,key,inspected.contentType(),inspected.bytes().length,
                    inspected.width(),inspected.height(),inspected.sha256(),alt,
                    replaced==null ? (int)count : replaced.displayOrder(),now,current.userId());
                if (inserted==0) {
                    var existing=replay(product,id,alt,inspected.sha256());
                    if (existing==null) throw new IdConflictException();
                    return existing;
                }
                if (replaced!=null) {
                    images.deleteByIdAndProductId(replaced.id(),product);
                    images.retire(replaced.id(),now);
                    deleteAfterCommit(replaced.objectKey());
                }
                images.flush(); images.checkOrderNow();
                return new ImageCreation(view(images.findById(id).orElseThrow(CatalogNotFoundException::new)),true);
            });
        } catch (RuntimeException original) {
            if (created[0]) compensate(product,key);
            throw original;
        }
    }
    private ProductImageInspector.InspectedImage inspect(byte[] bytes,String type,String filename) {
        boolean acquired=false;
        try {
            acquired=decoders.tryAcquire(decodeWaitMillis,TimeUnit.MILLISECONDS);
            if (!acquired) throw new StorageUnavailableException();
            return inspector.inspect(bytes,type,filename);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); throw new StorageUnavailableException();
        } finally { if (acquired) decoders.release(); }
    }
    private ImageCreation replay(UUID product,UUID id,String alt,String sha) {
        var row=images.findById(id);
        if (row.isPresent()) {
            var stored=row.get();
            if (!stored.productId().equals(product) || !Objects.equals(stored.altText(),alt)
                || !stored.sha256().equals(sha)) throw new IdConflictException();
            return new ImageCreation(view(stored),false);
        }
        if (images.isRetired(id)) throw new IdConflictException();
        return null;
    }
    ImageView updateAltText(UUID product,UUID id,String rawAlt,Long version,CurrentUser current) {
        CatalogAuthorization.require(current,CatalogArea.CATALOG);
        if (version==null || version<0) throw new InvalidCatalogException("version");
        String alt=ProductImageRules.altText(rawAlt).orElse(null);
        return transaction.execute(status -> {
            lockProduct(product);
            var image=images.findByIdAndProductId(id,product).orElseThrow(CatalogNotFoundException::new);
            if (image.version()!=version) throw new StaleUpdateException();
            image.updateAlt(alt,current.userId(),now()); images.flush();
            return view(image);
        });
    }
    ImageList reorder(UUID product,List<UUID> requested,List<UUID> expected,CurrentUser current) {
        CatalogAuthorization.require(current,CatalogArea.CATALOG);
        return transaction.execute(status -> {
            lockProduct(product);
            var rows=images.findByProductIdOrderByDisplayOrder(product);
            ProductImageRules.requireOrder(requested,expected,rows.stream().map(ProductImage::id).toList());
            Instant now=now();
            for (var image:rows) {
                int position=requested.indexOf(image.id());
                if (image.displayOrder()!=position) image.reorder(position,current.userId(),now);
            }
            images.flush(); images.checkOrderNow(); return listView(product);
        });
    }
    void remove(UUID product,UUID id,CurrentUser current) {
        CatalogAuthorization.require(current,CatalogArea.CATALOG);
        transaction.executeWithoutResult(status -> {
            lockProduct(product);
            var image=images.findByIdAndProductId(id,product).orElseThrow(CatalogNotFoundException::new);
            if (images.deleteByIdAndProductId(id,product)==0) throw new CatalogNotFoundException();
            images.retire(id,now()); images.shiftAfter(product,image.displayOrder());
            images.flush(); images.checkOrderNow(); deleteAfterCommit(image.objectKey());
        });
    }
    Optional<PublicImage> findPublic(String filename) {
        var parsed=ProductImageRules.parsePublicFileName(filename);
        if (parsed.isEmpty()) return Optional.empty();
        var row=read.execute(status -> images.findById(parsed.get().id()));
        if (row==null || row.isEmpty() || !ProductImageRules.extension(row.get().contentType()).equals(parsed.get().extension()))
            return Optional.empty();
        var object=storage.get(row.get().objectKey());
        if (object.isEmpty()) {
            Boolean exists=read.execute(status -> images.existsById(parsed.get().id()));
            if (Boolean.TRUE.equals(exists)) LOG.warn("Product image object missing");
        }
        return object.map(value -> new PublicImage(row.get().contentType(),value));
    }
    private void compensate(UUID product,String key) {
        try { transaction.executeWithoutResult(status -> {
            lockProduct(product);
            if (!images.existsByObjectKey(key)) storage.delete(key);
        }); } catch (Exception failure) { warn(failure); }
    }
    private void deleteAfterCommit(String key) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() { try { storage.delete(key); } catch (Exception failure) { warn(failure); } }
        });
    }
    private static void warn(Exception failure) { LOG.warn("{}",failure.getClass().getSimpleName()); }
    private void requireProduct(UUID id) { if (!products.existsById(id)) throw new CatalogNotFoundException(); }
    private void lockProduct(UUID id) { products.findByIdForUpdate(id).orElseThrow(CatalogNotFoundException::new); }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private ImageList listView(UUID product) { return new ImageList(images.findByProductIdOrderByDisplayOrder(product).stream().map(ProductImageService::view).toList(),ProductImageRules.MAX_IMAGES); }
    private static ImageView view(ProductImage image) { return new ImageView(image.id(),ProductImageRules.publicPath(image.id(),image.contentType()),image.contentType(),image.width(),image.height(),image.byteSize(),image.altText(),image.displayOrder(),image.version(),image.createdAt()); }
}
