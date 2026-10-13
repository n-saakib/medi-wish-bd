package bd.mediwish.catalog;

import bd.mediwish.testsupport.TestDatabase;
import liquibase.*;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import java.sql.SQLException;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

@Tag("integration")
class ProductImageMigrationIT {
    @ParameterizedTest @ValueSource(booleans={false,true})
    void emptyAndOccupied014SchemasUpgradeWithMetadataConstraints(boolean occupied) throws Exception {
        try(var database=TestDatabase.create()) {
            migrate(database,true);
            UUID category=UUID.randomUUID(),product=UUID.randomUUID(),image=UUID.randomUUID();
            if(occupied) seed(database,category,product);
            String before=occupied ? database.single("select to_jsonb(p)::text from products p where id=?",String.class,product) : null;
            migrate(database,false);
            if(occupied) assertThat(database.single("select to_jsonb(p)::text from products p where id=?",String.class,product)).isEqualTo(before);
            else seed(database,category,product);
            String key=ProductImageRules.objectKey(product,image,"image/png");
            database.update("insert into product_images(id,product_id,object_key,content_type,byte_size,width,height,sha256,display_order,created_at,updated_at) values(?,?,?,'image/png',1,1,1,?,0,now(),now())",image,product,key,"a".repeat(64));
            reject(database,image,"byte_size=0","ck_product_images_byte_size");
            reject(database,image,"width=0","ck_product_images_dimensions");
            reject(database,image,"height=0","ck_product_images_dimensions");
            reject(database,image,"alt_text=''","ck_product_images_alt_text");
            reject(database,image,"byte_size=3145729","ck_product_images_byte_size");
            reject(database,image,"width=4097","ck_product_images_dimensions");
            reject(database,image,"display_order=8","ck_product_images_display_order");
            reject(database,image,"version=-1","ck_product_images_version");
            reject(database,image,"sha256='invalid'","ck_product_images_sha256");
            reject(database,image,"alt_text=' padded '","ck_product_images_alt_text");
            reject(database,image,"object_key='products/other/object.png'","ck_product_images_key_owner");
            reject(database,image,"content_type='image/svg+xml'","ck_product_images_content_type");
            assertThat(database.single("select count(*) from information_schema.columns where table_schema=? and table_name in ('product_images','retired_product_image_ids') and udt_name in ('bytea','oid')",Long.class,database.schema())).isZero();
            assertThatThrownBy(() -> database.update("delete from products where id=?",product)).isInstanceOf(SQLException.class);
            UUID other=UUID.randomUUID();
            assertThatThrownBy(() -> database.update("insert into product_images(id,product_id,object_key,content_type,byte_size,width,height,sha256,display_order,created_at,updated_at) values(?,?,?,'image/png',1,1,1,?,0,now(),now())",other,product,ProductImageRules.objectKey(product,other,"image/png"),"a".repeat(64)))
                .isInstanceOf(SQLException.class).hasMessageContaining("uk_product_images_order");
            database.update("insert into retired_product_image_ids(id,retired_at) values(?,now())",UUID.randomUUID());
            UUID retired=database.single("select id from retired_product_image_ids",UUID.class);
            assertThatThrownBy(() -> database.update("insert into retired_product_image_ids(id,retired_at) values(?,now())",retired)).isInstanceOf(SQLException.class);
            UUID actor=UUID.randomUUID();
            try(var connection=database.connect()) {
                connection.setAutoCommit(false);
                try(var user=connection.prepareStatement("insert into users(id,username,mobile,password_hash,mobile_verified,created_at) values(?,'image_migration_user','01700004441','synthetic',false,now())");var role=connection.prepareStatement("insert into user_roles(user_id,role) values(?,'CUSTOMER')")) {
                    user.setObject(1,actor); user.executeUpdate(); role.setObject(1,actor); role.executeUpdate(); connection.commit();
                }
            }
            database.update("update product_images set created_by=?,updated_by=? where id=?",actor,actor,image);
            database.update("delete from users where id=?",actor);
            assertThat(database.single("select created_by is null and updated_by is null from product_images where id=?",Boolean.class,image)).isTrue();
            assertThat(database.single("select count(*) from pg_constraint where conname='uk_product_images_object_key' and contype='u' and connamespace=?::regnamespace",Long.class,database.schema())).isOne();
            migratePreviousChangelogWithImages(database);
            assertThat(database.single("select count(*) from product_images",Long.class)).isOne();
        }
    }
    @Test void statementTimeOrderFailureHasTheHibernateConstraintCauseAndCatalogStillEdits() throws Exception {
        try(var database=TestDatabase.create()) {
            migrate(database,false);
            UUID category=UUID.randomUUID(),product=UUID.randomUUID(),image=UUID.randomUUID(); seed(database,category,product);
            try(var app=bd.mediwish.testsupport.TestApplication.start(database.applicationProperties())) {
                var images=app.bean(ProductImageRepository.class);
                var products=app.bean(ProductRepository.class);
                var transaction=new org.springframework.transaction.support.TransactionTemplate(app.bean(org.springframework.transaction.PlatformTransactionManager.class));
                java.time.Instant now=java.time.Instant.now();
                transaction.executeWithoutResult(status -> images.insertIfAbsent(image,product,ProductImageRules.objectKey(product,image,"image/png"),"image/png",1,1,1,"a".repeat(64),null,0,now,null));
                Throwable failure=catchThrowable(() -> transaction.executeWithoutResult(status -> {
                    UUID duplicate=UUID.randomUUID();
                    images.insertIfAbsent(duplicate,product,ProductImageRules.objectKey(product,duplicate,"image/png"),"image/png",1,1,1,"a".repeat(64),null,0,now,null);
                    images.checkOrderNow();
                }));
                assertThat(failure).isNotNull();
                Throwable cause=failure;
                while(cause!=null && !(cause instanceof org.hibernate.exception.ConstraintViolationException)) cause=cause.getCause();
                assertThat(cause).isInstanceOf(org.hibernate.exception.ConstraintViolationException.class);
                assertThat(((org.hibernate.exception.ConstraintViolationException)cause).getConstraintName()).isEqualTo("uk_product_images_order");
                String imageBefore=database.single("select to_jsonb(i)::text from product_images i where id=?",String.class,image);
                transaction.executeWithoutResult(status -> {
                    var stored=products.findByIdForUpdate(product).orElseThrow();
                    stored.updatePricing(Money.parse("10.50"),null,null,now); products.flush();
                });
                assertThat(database.single("select selling_price from products where id=?",java.math.BigDecimal.class,product)).isEqualByComparingTo("10.50");
                assertThat(database.single("select to_jsonb(i)::text from product_images i where id=?",String.class,image)).isEqualTo(imageBefore);
            }
        }
    }
    private static void migratePreviousChangelogWithImages(TestDatabase database) throws Exception {
        var directory=java.nio.file.Files.createTempDirectory(java.nio.file.Path.of("target"),"ticket15-previous-");
        try {
            String path="db/changelog/db.changelog-master.yaml";
            String current=java.nio.file.Files.readString(java.nio.file.Path.of("src/main/resources").resolve(path));
            int marker=current.indexOf("      id: 015-product-images");
            assertThat(marker).isPositive();
            String previous=current.substring(0,current.lastIndexOf("  - changeSet:",marker));
            var file=directory.resolve(path); java.nio.file.Files.createDirectories(file.getParent()); java.nio.file.Files.writeString(file,previous);
            try(var resources=new liquibase.resource.DirectoryResourceAccessor(directory);var connection=database.connect()) {
                var db=DatabaseFactory.getInstance().findCorrectDatabaseImplementation(new JdbcConnection(connection));
                db.setDefaultSchemaName(database.schema()); db.setLiquibaseSchemaName(database.schema());
                new Liquibase(path,resources,db).update(new Contexts(),new LabelExpression());
            }
        } finally {
            try(var files=java.nio.file.Files.walk(directory)) { for(var file:files.sorted(java.util.Comparator.reverseOrder()).toList()) java.nio.file.Files.delete(file); }
        }
    }
    private static void reject(TestDatabase database,UUID image,String change,String constraint) {
        assertThatThrownBy(() -> database.update("update product_images set "+change+" where id=?",image)).isInstanceOf(SQLException.class).hasMessageContaining(constraint);
    }
    private static void seed(TestDatabase database,UUID category,UUID product) throws Exception {
        database.update("insert into product_categories(id,name,created_at,updated_at) values(?,'Image migration category',now(),now())",category);
        database.update("insert into products(id,kind,name,generic_name,dosage_form,sale_unit,category_id,created_at,updated_at) values(?,'MEDICINE','Synthetic image product','Synthetic generic','Tablet','Strip',?,now(),now())",product,category);
    }
    private static void migrate(TestDatabase database,boolean previous) throws Exception {
        try(var resources=new ClassLoaderResourceAccessor(Thread.currentThread().getContextClassLoader());var connection=database.connect()) {
            var db=DatabaseFactory.getInstance().findCorrectDatabaseImplementation(new JdbcConnection(connection));
            db.setDefaultSchemaName(database.schema()); db.setLiquibaseSchemaName(database.schema());
            var liquibase=new Liquibase("db/changelog/db.changelog-master.yaml",resources,db);
            var changes=liquibase.getDatabaseChangeLog().getChangeSets();
            int imagePosition=-1;
            for(int i=0;i<changes.size();i++) if("015-product-images".equals(changes.get(i).getId())) imagePosition=i;
            assertThat(imagePosition).isPositive();
            if(previous) liquibase.update(imagePosition,new Contexts(),new LabelExpression());
            else liquibase.update(new Contexts(),new LabelExpression());
        }
    }
}
