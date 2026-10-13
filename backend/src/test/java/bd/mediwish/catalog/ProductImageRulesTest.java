package bd.mediwish.catalog;
import org.junit.jupiter.api.Test;
import java.util.*;
import bd.mediwish.web.StaleUpdateException;
import static org.assertj.core.api.Assertions.*;
class ProductImageRulesTest {
 @Test void onlyDeclaredJpegAndPngWithMatchingNamesAreAccepted() {
  assertThat(ProductImageRules.typeForDeclared("image/png", "front.PNG")).isEqualTo("image/png");
  assertThat(ProductImageRules.typeForDeclared("image/jpeg", "front.jpeg")).isEqualTo("image/jpeg");
  for(String type:new String[]{"image/gif","image/svg+xml","text/html","IMAGE/PNG","",null}) assertThatThrownBy(()->ProductImageRules.typeForDeclared(type,"front.png")).isInstanceOf(InvalidImageException.class);
  assertThatThrownBy(()->ProductImageRules.typeForDeclared("image/png","front.jpg")).isInstanceOf(InvalidImageException.class);
 }
 @Test void sizeBoundariesAreExactlyThreeMiB() {
  ProductImageRules.requireSize(1); ProductImageRules.requireSize(3_145_728);
  assertThatThrownBy(()->ProductImageRules.requireSize(0)).isInstanceOf(InvalidImageException.class);
  assertThatThrownBy(()->ProductImageRules.requireSize(3_145_729)).isInstanceOf(InvalidImageException.class);
 }
 @Test void keysAndPublicPathsHaveCanonicalIdentityAndOwnership() {
  UUID product=UUID.randomUUID(), image=UUID.fromString("abcdefab-abcd-abcd-abcd-abcdefabcdef");
  String key=ProductImageRules.objectKey(product,image,"image/jpeg");
  assertThat(key).isEqualTo("products/"+product+"/"+image+".jpg");
  assertThat(ProductImageRules.objectKey(UUID.randomUUID(),image,"image/jpeg")).isNotEqualTo(key);
  assertThat(ProductImageRules.publicPath(image,"image/png")).isEqualTo("/api/public/product-images/"+image+".png");
  assertThat(ProductImageRules.parsePublicFileName(image+".png")).isPresent();
  for(String name:new String[]{"..","%2e",image.toString().toUpperCase(Locale.ROOT)+".png",image+".jpeg",image+".PNG",image+".png.jpg",image+".png/","",image+"x.png"}) assertThat(ProductImageRules.parsePublicFileName(name)).isEmpty();
 }
 @Test void altTextIsOptionalTrimmedBoundedAndControlFree() {
  assertThat(ProductImageRules.altText(null)).isEmpty(); assertThat(ProductImageRules.altText("  ")).isEmpty();
  assertThat(ProductImageRules.altText(" front ")).contains("front"); assertThat(ProductImageRules.altText("x".repeat(160))).isPresent();
  for(String text:new String[]{"x".repeat(161),"front\n", "\u0000"}) assertThatThrownBy(()->ProductImageRules.altText(text)).isInstanceOf(InvalidCatalogException.class);
 }
 @Test void orderingValidatesBothSetsAndTheObservedSequence() {
  UUID a=UUID.randomUUID(),b=UUID.randomUUID(); List<UUID> current=List.of(a,b);
  ProductImageRules.requireOrder(List.of(b,a),current,current);
  ProductImageRules.requireOrder(List.of(),List.of(),List.of());
  assertThatThrownBy(()->ProductImageRules.requireOrder(List.of(a,a),current,current)).isInstanceOf(InvalidCatalogException.class);
  assertThatThrownBy(()->ProductImageRules.requireOrder(current,List.of(a,a),current)).isInstanceOf(InvalidCatalogException.class);
  assertThatThrownBy(()->ProductImageRules.requireOrder(Arrays.asList(a,null),current,current)).isInstanceOf(InvalidCatalogException.class);
  var nine=java.util.stream.IntStream.range(0,9).mapToObj(i->UUID.randomUUID()).toList();
  assertThatThrownBy(()->ProductImageRules.requireOrder(nine,nine,nine)).isInstanceOf(InvalidCatalogException.class);
  assertThatThrownBy(()->ProductImageRules.requireOrder(List.of(a),current,current)).isInstanceOf(InvalidCatalogException.class);
  assertThatThrownBy(()->ProductImageRules.requireOrder(List.of(a),List.of(a),current)).isInstanceOf(StaleUpdateException.class);
  assertThatThrownBy(()->ProductImageRules.requireOrder(current,List.of(b,a),current)).isInstanceOf(StaleUpdateException.class);
 }
}
