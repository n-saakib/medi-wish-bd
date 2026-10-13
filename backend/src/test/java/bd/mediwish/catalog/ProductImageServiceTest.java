package bd.mediwish.catalog;

import bd.mediwish.auth.CurrentUserAuthentication.CurrentUser;
import bd.mediwish.auth.MfaStatus;
import bd.mediwish.user.*;
import bd.mediwish.storage.*;
import bd.mediwish.web.StaleUpdateException;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.*;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ProductImageServiceTest {
    private final ProductRepository products=mock(ProductRepository.class);
    private final ProductImageRepository images=mock(ProductImageRepository.class);
    private final ObjectStorage storage=mock(ObjectStorage.class);
    private final ProductImageInspector inspector=mock(ProductImageInspector.class);
    private final UUID product=UUID.randomUUID(), id=UUID.randomUUID();
    private final CurrentUser current=new CurrentUser(UUID.randomUUID(),UUID.randomUUID(),new UserProfile("staff","01700000000",null,false),Set.of(UserRole.ADMIN),MfaStatus.VERIFIED,Set.of("ROLE_ADMIN"));
    private final ProductImageService service=new ProductImageService(products,images,storage,inspector,Clock.fixed(Instant.parse("2026-10-12T00:00:00Z"),ZoneOffset.UTC),new Transactions());
    private ProductImage row() {
        var row=mock(ProductImage.class);
        when(row.id()).thenReturn(id); when(row.productId()).thenReturn(product);
        when(row.contentType()).thenReturn("image/png"); when(row.sha256()).thenReturn("a".repeat(64));
        when(row.objectKey()).thenReturn(ProductImageRules.objectKey(product,id,"image/png"));
        return row;
    }
    private void prepare() {
        when(products.existsById(product)).thenReturn(true);
        when(products.findByIdForUpdate(product)).thenReturn(Optional.of(mock(Product.class)));
        doReturn(new ProductImageInspector.InspectedImage("image/png",1,1,new byte[]{1},"a".repeat(64))).when(inspector).inspect(any(),anyString(),anyString());
        when(images.findById(any())).thenReturn(Optional.empty());
    }
    private ProductImageViews.ImageCreation upload() { return service.upload(product,id,new byte[]{1},"image/png","front.png",null,null,current); }
    @Test void identicalReplayNeverLocksOrWritesStorage() {
        prepare(); var stored=row(); when(images.findById(id)).thenReturn(Optional.of(stored));
        assertThat(upload().created()).isFalse(); verify(products,never()).findByIdForUpdate(any()); verifyNoInteractions(storage);
    }
    @Test void anotherProductsIdentityAndRetiredIdsCannotBeReused() {
        prepare(); var row=row(); when(row.productId()).thenReturn(UUID.randomUUID()); when(images.findById(id)).thenReturn(Optional.of(row));
        assertThatThrownBy(this::upload).isInstanceOf(IdConflictException.class);
        when(images.findById(id)).thenReturn(Optional.empty()); when(images.isRetired(id)).thenReturn(true);
        assertThatThrownBy(this::upload).isInstanceOf(IdConflictException.class); verifyNoInteractions(storage);
    }
    @Test void rollbackCompensatesOnlyObjectsCreatedByThisRequest() {
        prepare(); when(storage.put(anyString(),any())).thenReturn(ObjectStorage.PutResult.CREATED);
        var original=new IllegalStateException("synthetic");
        when(images.insertIfAbsent(any(),any(),anyString(),anyString(),anyInt(),anyInt(),anyInt(),anyString(),isNull(),anyInt(),any(),any())).thenThrow(original);
        assertThatThrownBy(this::upload).isSameAs(original); verify(storage).delete(ProductImageRules.objectKey(product,id,"image/png"));
    }
    @Test void rollbackPreservesAnAlreadyPresentOrCommittedObject() {
        prepare(); when(storage.put(anyString(),any())).thenReturn(ObjectStorage.PutResult.ALREADY_PRESENT);
        when(images.insertIfAbsent(any(),any(),anyString(),anyString(),anyInt(),anyInt(),anyInt(),anyString(),isNull(),anyInt(),any(),any())).thenThrow(new IllegalStateException());
        assertThatThrownBy(this::upload).isInstanceOf(IllegalStateException.class); verify(storage,never()).delete(anyString());
        when(storage.put(anyString(),any())).thenReturn(ObjectStorage.PutResult.CREATED); when(images.existsByObjectKey(anyString())).thenReturn(true);
        assertThatThrownBy(this::upload).isInstanceOf(IllegalStateException.class); verify(storage,never()).delete(anyString());
    }
    @Test void deleteRunsAfterCommitAndFailureDoesNotChangeTheSuccess() {
        prepare(); var row=row(); when(images.findByIdAndProductId(id,product)).thenReturn(Optional.of(row));
        when(images.deleteByIdAndProductId(id,product)).thenReturn(1);
        doAnswer(call -> { assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue(); throw new StorageUnavailableException(); }).when(storage).delete(anyString());
        service.remove(product,id,current); verify(images).retire(eq(id),any()); verify(images).checkOrderNow(); verify(storage).delete(row.objectKey());
    }
    @Test void staleAltChangeFailsEvenWhenTextIsUnchanged() {
        prepare(); var row=row(); when(row.version()).thenReturn(2L); when(images.findByIdAndProductId(id,product)).thenReturn(Optional.of(row));
        assertThatThrownBy(() -> service.updateAltText(product,id,"new",1L,current)).isInstanceOf(StaleUpdateException.class);
        assertThatThrownBy(() -> service.updateAltText(product,id,null,1L,current)).isInstanceOf(StaleUpdateException.class);
        service.updateAltText(product,id,null,2L,current); verify(row).updateAlt(isNull(),eq(current.userId()),any());
    }
    @Test void theNinthUploadDoesNotTouchObjectStorage() {
        prepare(); when(images.countByProductId(product)).thenReturn(8L);
        assertThatThrownBy(this::upload).isInstanceOf(ImageLimitReachedException.class); verifyNoInteractions(storage);
    }
    @Test void authorizationPrecedesInspectionAndStorage() {
        for(UserRole role:new UserRole[]{UserRole.CUSTOMER,UserRole.DELIVERY_PERSON}) {
            var denied=new CurrentUser(current.userId(),UUID.randomUUID(),new UserProfile("staff","01700000000",null,false),Set.of(role),MfaStatus.NOT_REQUIRED,Set.of("ROLE_"+role.name()));
            assertThatThrownBy(() -> service.upload(product,id,new byte[]{1},"image/png","front.png",null,null,denied)).isInstanceOf(CatalogAccessDeniedException.class);
        }
        assertThatThrownBy(() -> service.upload(product,id,new byte[]{1},"image/png","front.png",null,null,null)).isInstanceOf(CatalogAccessDeniedException.class);
        verifyNoInteractions(products,images,inspector,storage);
    }
    @Test void invalidDecodeAndStorageFailureWriteNothing() {
        prepare(); doThrow(new InvalidImageException()).when(inspector).inspect(any(),anyString(),anyString());
        assertThatThrownBy(this::upload).isInstanceOf(InvalidImageException.class); verifyNoInteractions(storage);
        doReturn(new ProductImageInspector.InspectedImage("image/png",1,1,new byte[]{1},"a".repeat(64))).when(inspector).inspect(any(),anyString(),anyString());
        when(storage.put(anyString(),any())).thenThrow(new StorageUnavailableException());
        assertThatThrownBy(this::upload).isInstanceOf(StorageUnavailableException.class);
        verify(images,never()).insertIfAbsent(any(),any(),anyString(),anyString(),anyInt(),anyInt(),anyInt(),anyString(),any(),anyInt(),any(),any());
    }
    @Test void replayAndRetirementAreCheckedAgainUnderProductLock() {
        prepare(); var stored=row(); when(images.findById(id)).thenReturn(Optional.empty(),Optional.of(stored));
        when(images.countByProductId(product)).thenReturn(8L);
        assertThat(upload().created()).isFalse(); verifyNoInteractions(storage);
        when(images.findById(id)).thenReturn(Optional.empty()); when(images.isRetired(id)).thenReturn(false,true);
        assertThatThrownBy(this::upload).isInstanceOf(IdConflictException.class); verifyNoInteractions(storage);
    }
    @Test void aRemoveRollbackNeverDeletesAnObject() {
        prepare(); var stored=row(); when(images.findByIdAndProductId(id,product)).thenReturn(Optional.of(stored)); when(images.deleteByIdAndProductId(id,product)).thenReturn(1);
        doThrow(new StaleUpdateException()).when(images).checkOrderNow();
        assertThatThrownBy(() -> service.remove(product,id,current)).isInstanceOf(StaleUpdateException.class); verifyNoInteractions(storage);
    }
    @Test void compensationFailureKeepsTheOriginalError() {
        prepare(); when(storage.put(anyString(),any())).thenReturn(ObjectStorage.PutResult.CREATED);
        var original=new IllegalStateException("original");
        when(images.insertIfAbsent(any(),any(),anyString(),anyString(),anyInt(),anyInt(),anyInt(),anyString(),isNull(),anyInt(),any(),any())).thenThrow(original);
        when(products.findByIdForUpdate(product)).thenReturn(Optional.of(mock(Product.class))).thenThrow(new IllegalStateException("compensation"));
        assertThatThrownBy(this::upload).isSameAs(original); verify(storage,never()).delete(anyString());
    }
    @Test void replacementRetiresAndDeletesTheOldObjectAfterCommit() {
        prepare(); UUID old=UUID.randomUUID(); var stored=row(); when(stored.id()).thenReturn(old); when(stored.displayOrder()).thenReturn(3);
        String oldKey=ProductImageRules.objectKey(product,old,"image/png"); when(stored.objectKey()).thenReturn(oldKey);
        when(images.findByIdAndProductId(old,product)).thenReturn(Optional.of(stored));
        when(images.countByProductId(product)).thenReturn(8L); when(storage.put(anyString(),any())).thenReturn(ObjectStorage.PutResult.CREATED);
        when(images.insertIfAbsent(any(),any(),anyString(),anyString(),anyInt(),anyInt(),anyInt(),anyString(),isNull(),eq(3),any(),any())).thenReturn(1);
        var created=row(); when(images.findById(id)).thenReturn(Optional.empty(),Optional.empty(),Optional.of(created));
        doThrow(new StorageUnavailableException()).when(storage).delete(oldKey);
        var result=service.upload(product,id,new byte[]{1},"image/png","front.png",null,old,current);
        assertThat(result.created()).isTrue(); verify(images).retire(eq(old),any()); verify(storage).delete(oldKey);
        verify(storage,never()).delete(ProductImageRules.objectKey(product,id,"image/png"));
    }
    @Test void decoderSaturationIsBoundedAndFailedDecodesReleasePermits() throws Exception {
        prepare();
        var bounded=new ProductImageService(products,images,storage,inspector,Clock.systemUTC(),new Transactions(),100);
        var entered=new java.util.concurrent.CountDownLatch(2); var release=new java.util.concurrent.CountDownLatch(1);
        when(inspector.inspect(any(),anyString(),anyString())).thenAnswer(call -> { entered.countDown(); release.await(5,java.util.concurrent.TimeUnit.SECONDS); throw new InvalidImageException(); });
        try(var executor=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var one=executor.submit(() -> bounded.upload(product,UUID.randomUUID(),new byte[]{1},"image/png","front.png",null,null,current));
            var two=executor.submit(() -> bounded.upload(product,UUID.randomUUID(),new byte[]{1},"image/png","front.png",null,null,current));
            try {
                assertThat(entered.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> bounded.upload(product,UUID.randomUUID(),new byte[]{1},"image/png","front.png",null,null,current)).isInstanceOf(StorageUnavailableException.class);
            } finally { release.countDown(); }
            for(var future:List.of(one,two)) assertThatThrownBy(() -> future.get(5,java.util.concurrent.TimeUnit.SECONDS)).hasCauseInstanceOf(InvalidImageException.class);
        }
        doThrow(new InvalidImageException()).when(inspector).inspect(any(),anyString(),anyString());
        assertThatThrownBy(() -> bounded.upload(product,id,new byte[]{1},"image/png","front.png",null,null,current)).isInstanceOf(InvalidImageException.class);
        verifyNoInteractions(storage);
    }
    @Test void cleanupFailuresLogOnlyTheExceptionClass() {
        prepare(); var stored=row(); when(images.findByIdAndProductId(id,product)).thenReturn(Optional.of(stored));
        when(images.deleteByIdAndProductId(id,product)).thenReturn(1);
        var logger=(ch.qos.logback.classic.Logger)org.slf4j.LoggerFactory.getLogger(ProductImageService.class);
        var captured=new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        captured.start(); logger.addAppender(captured);
        try {
            doThrow(new StorageUnavailableException()).when(storage).delete(anyString());
            service.remove(product,id,current);
            assertThat(captured.list).extracting(ch.qos.logback.classic.spi.ILoggingEvent::getFormattedMessage).containsExactly("StorageUnavailableException");
            assertThat(captured.list).allSatisfy(event -> assertThat(event.getThrowableProxy()).isNull());
            captured.list.clear();
            when(storage.put(anyString(),any())).thenReturn(ObjectStorage.PutResult.CREATED);
            var original=new IllegalStateException("synthetic original diagnostic");
            when(images.insertIfAbsent(any(),any(),anyString(),anyString(),anyInt(),anyInt(),anyInt(),anyString(),isNull(),anyInt(),any(),any())).thenThrow(original);
            doReturn(Optional.of(mock(Product.class))).doThrow(new IllegalStateException("synthetic private compensation diagnostic")).when(products).findByIdForUpdate(product);
            assertThatThrownBy(this::upload).isSameAs(original);
            assertThat(captured.list).extracting(ch.qos.logback.classic.spi.ILoggingEvent::getFormattedMessage).containsExactly("IllegalStateException");
            assertThat(captured.list).allSatisfy(event -> assertThat(event.getThrowableProxy()).isNull());
        } finally { logger.detachAppender(captured); captured.stop(); }
    }
    @Test void unverifiedAdminAndStorageObjectConflictAreBounded() {
        var unverified=new CurrentUser(current.userId(),UUID.randomUUID(),new UserProfile("staff","01700000000",null,false),Set.of(UserRole.ADMIN),MfaStatus.ENROLLMENT_REQUIRED,Set.of("ROLE_ADMIN"));
        assertThatThrownBy(() -> service.upload(product,id,new byte[]{1},"image/png","front.png",null,null,unverified)).isInstanceOf(CatalogAccessDeniedException.class);
        verifyNoInteractions(storage,inspector);
        prepare(); when(storage.put(anyString(),any())).thenThrow(new ObjectConflictException());
        assertThatThrownBy(this::upload).isInstanceOf(IdConflictException.class); verify(storage,never()).delete(anyString());
    }
    private static class Transactions extends AbstractPlatformTransactionManager {
        protected Object doGetTransaction() { return new Object(); }
        protected void doBegin(Object transaction,TransactionDefinition definition) {}
        protected void doCommit(DefaultTransactionStatus status) {}
        protected void doRollback(DefaultTransactionStatus status) {}
    }
}
