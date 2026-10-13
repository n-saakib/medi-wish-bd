package bd.mediwish.catalog;

import org.springframework.stereotype.Component;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.IIOImage;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;

@Component
class ProductImageInspector {
    private final int maxBytes;
    ProductImageInspector() { this(ProductImageRules.MAX_BYTES); }
    ProductImageInspector(int maxBytes) { this.maxBytes = maxBytes; }

    InspectedImage inspect(byte[] bytes, String declaredType, String filename) {
        if (bytes == null || bytes.length < 1 || bytes.length > maxBytes) throw new InvalidImageException();
        String type = ProductImageRules.typeForDeclared(declaredType, filename);
        byte[] png = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
        boolean isPng = bytes.length >= 8 && Arrays.equals(Arrays.copyOf(bytes, 8), png);
        boolean isJpeg = bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255;
        if (!("image/png".equals(type) ? isPng : isJpeg)) throw new InvalidImageException();
        var readers = ImageIO.getImageReadersByMIMEType(type);
        if (!readers.hasNext()) throw new InvalidImageException();
        var reader = readers.next();
        try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            reader.setInput(input, true, true);
            int width = reader.getWidth(0), height = reader.getHeight(0);
            if (width < 1 || height < 1 || width > ProductImageRules.MAX_SIDE || height > ProductImageRules.MAX_SIDE) throw new InvalidImageException();
            var image = reader.read(0);
            if (image == null) throw new InvalidImageException();
            var writers = ImageIO.getImageWritersByMIMEType(type);
            if (!writers.hasNext()) throw new InvalidImageException();
            var writer = writers.next();
            var output = new ByteArrayOutputStream();
            try (var encoded = new MemoryCacheImageOutputStream(output)) {
                writer.setOutput(encoded);
                var parameters = writer.getDefaultWriteParam();
                if ("image/jpeg".equals(type)) {
                    parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                    parameters.setCompressionQuality(0.90f);
                }
                writer.write(null, new IIOImage(image, null, null), parameters);
                encoded.flush();
            } finally { writer.dispose(); image.flush(); }
            byte[] encoded = output.toByteArray();
            if (encoded.length < 1 || encoded.length > maxBytes) throw new InvalidImageException();
            return new InspectedImage(type, width, height, encoded, sha256(encoded));
        } catch (IOException | RuntimeException invalid) {
            throw new InvalidImageException();
        } finally { reader.dispose(); }
    }
    private static String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    record InspectedImage(String contentType, int width, int height, byte[] bytes, String sha256) {}
}
