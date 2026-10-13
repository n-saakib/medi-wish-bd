package bd.mediwish.storage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
class LocalObjectStorageTest {
 @TempDir Path root;
 @Test void createOnlyWritesPreserveOriginalAndOpenReadersSurviveDeletion() throws Exception {
  var storage=new LocalObjectStorage(root,"test-unit");
  String key="products/"+UUID.randomUUID()+"/"+UUID.randomUUID()+".png";
  byte[] original={1,2,3};
  assertThat(storage.put(key,original)).isEqualTo(ObjectStorage.PutResult.CREATED);
  assertThat(storage.put(key,original)).isEqualTo(ObjectStorage.PutResult.ALREADY_PRESENT);
  assertThatThrownBy(()->storage.put(key,new byte[]{4})).isInstanceOf(ObjectConflictException.class);
  var object=storage.get(key).orElseThrow();
  try(var stream=object.content()) {
   assertThat(stream.read()).isEqualTo(1);
   storage.delete(key);
   assertThat(storage.get(key)).isEmpty();
   assertThat(stream.readAllBytes()).containsExactly(2,3);
  }
  storage.delete(key);
 }
 @Test void noncanonicalKeysCannotEscapeTheNamespace() {
  var storage=new LocalObjectStorage(root,"test-unit");
  for(String key:new String[]{"../x","/abs","products\\a","products/a/../../b.png","products/ABCDEFAB-ABCD-ABCD-ABCD-ABCDEFABCDEF/abcdefab-abcd-abcd-abcd-abcdefabcdef.png"}) {
   assertThatThrownBy(()->storage.put(key,new byte[]{1})).isInstanceOf(IllegalArgumentException.class);
   assertThatThrownBy(()->storage.get(key)).isInstanceOf(IllegalArgumentException.class);
   assertThatThrownBy(()->storage.delete(key)).isInstanceOf(IllegalArgumentException.class);
  }
 }
 @Test void temporaryFilesAreRemovedAndRegularFileRootsFailBoundedly() throws Exception {
  var storage=new LocalObjectStorage(root,"test-unit");
  String key="products/"+UUID.randomUUID()+"/"+UUID.randomUUID()+".png";
  storage.put(key,new byte[]{1}); storage.put(key,new byte[]{1});
  assertThatThrownBy(()->storage.put(key,new byte[]{2})).isInstanceOf(ObjectConflictException.class);
  try(var files=java.nio.file.Files.walk(root)) { assertThat(files.filter(path->path.toString().endsWith(".tmp")).toList()).isEmpty(); }
  Path invalid=root.resolve("regular-file"); java.nio.file.Files.write(invalid,new byte[]{1});
  assertThatThrownBy(()->new LocalObjectStorage(invalid,"test-unit").put(key,new byte[]{1})).isInstanceOf(StorageUnavailableException.class);
 }
}
