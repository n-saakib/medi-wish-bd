package bd.mediwish.catalog;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import static org.assertj.core.api.Assertions.*;

class ProductImageInspectorTest {
    static byte[] fixture(String format,int width,int height) throws IOException {
        var output=new ByteArrayOutputStream();
        var image=new BufferedImage(width,height,"png".equals(format)?BufferedImage.TYPE_INT_ARGB:BufferedImage.TYPE_INT_RGB);
        image.setRGB(0,0,0xff4488cc); ImageIO.write(image,format,output); image.flush(); return output.toByteArray();
    }
    @Test void pngIsDecodedReencodedAndTrailingPayloadIsDiscarded() throws Exception {
        byte[] original=fixture("png",4,3);
        var output=new ByteArrayOutputStream(); output.write(original); output.write("Synthetic trailing payload".getBytes(StandardCharsets.UTF_8));
        var image=new ProductImageInspector().inspect(output.toByteArray(),"image/png","front.png");
        assertThat(image.width()).isEqualTo(4); assertThat(image.height()).isEqualTo(3);
        assertThat(image.bytes()).isEqualTo(original); assertThat(image.sha256()).matches("[0-9a-f]{64}");
    }
    @ParameterizedTest @ValueSource(strings={"png","jpg"})
    void encodingIsDeterministicAcrossProcessesOnTheSameRuntime(String format) throws Exception {
        byte[] bytes=fixture(format,4,3); String type=format.equals("png")?"image/png":"image/jpeg";
        var inspector=new ProductImageInspector();
        var first=inspector.inspect(bytes,type,"front."+format);
        assertThat(inspector.inspect(bytes,type,"front."+format).sha256()).isEqualTo(first.sha256());
        var process=new ProcessBuilder(ProcessHandle.current().info().command().orElseThrow(),"-cp",System.getProperty("java.class.path"),EncoderProbe.class.getName(),format).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        assertThat(process.waitFor(30,TimeUnit.SECONDS)).isTrue();
        assertThat(process.exitValue()).isZero(); assertThat(new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8).trim()).isEqualTo(first.sha256());
    }
    public static class EncoderProbe {
        public static void main(String[] args) throws Exception {
            String format=args[0];
            System.out.println(new ProductImageInspector().inspect(fixture(format,4,3),format.equals("png")?"image/png":"image/jpeg","front."+format).sha256());
        }
    }
    @Test void jpegExifIsRemoved() throws Exception {
        byte[] original=fixture("jpg",4,3); var output=new ByteArrayOutputStream(); output.write(original,0,2);
        byte[] metadata="Exif\u0000\u0000Synthetic".getBytes(StandardCharsets.US_ASCII);
        output.write(new byte[]{(byte)0xff,(byte)0xe1,0,(byte)(metadata.length+2)}); output.write(metadata); output.write(original,2,original.length-2);
        var image=new ProductImageInspector().inspect(output.toByteArray(),"image/jpeg","front.jpg");
        assertThat(new String(image.bytes(),StandardCharsets.ISO_8859_1)).doesNotContain("Exif");
    }
    @Test void mismatchedAndExecutableAndTruncatedBodiesAreRejected() throws Exception {
        var inspector=new ProductImageInspector();
        assertThatThrownBy(()->inspector.inspect(fixture("png",1,1),"image/jpeg","front.jpg")).isInstanceOf(InvalidImageException.class);
        for(byte[] bytes:new byte[][]{"<html>".getBytes(StandardCharsets.US_ASCII),"MZsynthetic".getBytes(StandardCharsets.US_ASCII),"GIF89a".getBytes(StandardCharsets.US_ASCII),Arrays.copyOf(fixture("png",1,1),12)})
            assertThatThrownBy(()->inspector.inspect(bytes,"image/png","front.png")).isInstanceOf(InvalidImageException.class);
    }
    @Test void dimensionsAreCheckedBeforePixelAllocation() throws Exception {
        byte[] bytes=fixture("png",1,1);
        var buffer=java.nio.ByteBuffer.wrap(bytes); buffer.putInt(16,100000); buffer.putInt(20,100000);
        var crc=new java.util.zip.CRC32(); crc.update(bytes,12,17); buffer.putInt(29,(int)crc.getValue());
        org.junit.jupiter.api.Assertions.assertTimeout(Duration.ofSeconds(2), () ->
            assertThatThrownBy(()->new ProductImageInspector().inspect(bytes,"image/png","front.png")).isInstanceOf(InvalidImageException.class));
        assertThat(new ProductImageInspector().inspect(fixture("png",4096,1),"image/png","front.png").width()).isEqualTo(4096);
        assertThatThrownBy(()->new ProductImageInspector().inspect(fixture("png",4097,1),"image/png","front.png")).isInstanceOf(InvalidImageException.class);
    }
    @Test void reencodedBytesMustAlsoFitTheConfiguredLimit() throws Exception {
        var image=new BufferedImage(512,512,BufferedImage.TYPE_INT_RGB);
        var random=new java.util.Random(15); int[] row=new int[512];
        for(int x=0;x<row.length;x++) row[x]=0xff000000|random.nextInt(0x1000000);
        for(int y=0;y<512;y++) image.setRGB(0,y,512,1,row,0,512);
        var bytes=new ByteArrayOutputStream();
        var writer=ImageIO.getImageWritersByMIMEType("image/jpeg").next();
        try(var output=new javax.imageio.stream.MemoryCacheImageOutputStream(bytes)) {
            writer.setOutput(output); var parameters=writer.getDefaultWriteParam();
            parameters.setCompressionMode(javax.imageio.ImageWriteParam.MODE_EXPLICIT); parameters.setCompressionQuality(0.10f);
            writer.write(null,new javax.imageio.IIOImage(image,null,null),parameters); output.flush();
        } finally { writer.dispose(); image.flush(); }
        byte[] original=bytes.toByteArray();
        var encoded=new ProductImageInspector().inspect(original,"image/jpeg","front.jpg");
        assertThat(encoded.bytes().length).as("default sanitized encoding exceeds the low-quality JPEG fixture").isGreaterThan(original.length);
        assertThatThrownBy(() -> new ProductImageInspector(original.length).inspect(original,"image/jpeg","front.jpg")).isInstanceOf(InvalidImageException.class);
    }
    @Test void recordsWorstCaseSixteenBitRgbaDecodeMemory() throws Exception {
        // Build compressed scanlines directly without allocating decoded fixture pixels.
        var compressed=new ByteArrayOutputStream();
        try(var deflated=new java.util.zip.DeflaterOutputStream(compressed)) {
            byte[] row=new byte[1+4096*8];
            for(int y=0;y<4096;y++) deflated.write(row);
        }
        var png=new ByteArrayOutputStream();
        png.write(new byte[]{(byte)137,80,78,71,13,10,26,10});
        var header=java.nio.ByteBuffer.allocate(13).putInt(4096).putInt(4096)
                .put((byte)16).put((byte)6).put((byte)0).put((byte)0).put((byte)0).array();
        chunk(png,"IHDR",header); chunk(png,"IDAT",compressed.toByteArray()); chunk(png,"IEND",new byte[0]);
        byte[] fixture=png.toByteArray();
        assertThat(fixture.length).isLessThanOrEqualTo(ProductImageRules.MAX_BYTES);
        var pools=java.lang.management.ManagementFactory.getMemoryPoolMXBeans().stream()
                .filter(pool->pool.getType()==java.lang.management.MemoryType.HEAP).toList();
        long beforeHeap=pools.stream().mapToLong(pool->pool.getUsage().getUsed()).sum();
        pools.forEach(java.lang.management.MemoryPoolMXBean::resetPeakUsage);
        var threads=(com.sun.management.ThreadMXBean)java.lang.management.ManagementFactory.getThreadMXBean();
        assertThat(threads.isThreadAllocatedMemorySupported()).isTrue();
        threads.setThreadAllocatedMemoryEnabled(true);
        long thread=Thread.currentThread().threadId(), before=threads.getThreadAllocatedBytes(thread);
        var result=new ProductImageInspector().inspect(fixture,"image/png","worst-case.png");
        long allocated=threads.getThreadAllocatedBytes(thread)-before;
        long peakHeap=pools.stream().mapToLong(pool->pool.getPeakUsage().getUsed()).sum();
        long maxHeap=Runtime.getRuntime().maxMemory();
        assertThat(result.width()).isEqualTo(4096); assertThat(result.height()).isEqualTo(4096);
        assertThat(result.bytes().length).isLessThanOrEqualTo(ProductImageRules.MAX_BYTES);
        assertThat(allocated).isGreaterThanOrEqualTo(4096L*4096*8);
        System.out.printf("T15 worst-case PNG: inputBytes=%d outputBytes=%d threadAllocatedBytes=%d "
                +"heapBeforeBytes=%d peakHeapBytes=%d maxHeapBytes=%d twoAllocationFraction=%.6f%n",
                fixture.length,result.bytes().length,allocated,beforeHeap,peakHeap,maxHeap,2.0*allocated/maxHeap);
    }
    private static void chunk(ByteArrayOutputStream out,String type,byte[] payload) throws IOException {
        byte[] name=type.getBytes(StandardCharsets.US_ASCII);
        var data=new DataOutputStream(out); data.writeInt(payload.length); data.write(name); data.write(payload);
        var crc=new java.util.zip.CRC32(); crc.update(name); crc.update(payload); data.writeInt((int)crc.getValue());
    }
}
