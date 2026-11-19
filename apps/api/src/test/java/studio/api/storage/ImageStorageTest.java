package studio.api.storage;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import studio.api.common.ApiException;
import studio.api.provider.GeneratedImage;
import studio.api.provider.ProviderResult;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class ImageStorageTest {
    @TempDir Path temp;

    private ImageStorage storage() { return new ImageStorage(temp); }
    private ProviderResult result(List<GeneratedImage> images) { return new ProviderResult("p", "m", "", images, "2026-01-01T00:00:00Z"); }
    private GeneratedImage encoded(byte[] data) { return new GeneratedImage("ignored", Base64.getEncoder().encodeToString(data), null); }
    private byte[] png() { return new byte[]{(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 1, 2, 3}; }
    private List<ImageRecord> save(ImageStorage storage, ProviderResult result, String task) {
        return storage.writeResult(result, "prompt", task, (record, bytes) -> storage.writeLocal(record.url(), bytes));
    }

    @Test void savesRawImageBytesAndCanReadAndRemoveIdempotently() {
        ImageStorage storage = storage();
        byte[] raw = png();
        ImageRecord record = save(storage, result(List.of(encoded(raw))), UUID.randomUUID().toString()).getFirst();
        assertEquals("image/png", record.mimeType());
        assertEquals(raw.length, record.bytes());
        assertArrayEquals(raw, storage.read(record.url()));
        assertNull(record.retentionDays());
        assertNull(record.expiresAt());
        storage.remove(record.url());
        storage.remove(record.url());
        assertThrows(ApiException.class, () -> storage.read(record.url()));
    }

    @Test void rejectsInvalidSignatureStrictBase64OversizeAndEscapingPaths() {
        ImageStorage storage = storage();
        String task = UUID.randomUUID().toString();
        assertThrows(ApiException.class, () -> save(storage, result(List.of(encoded("not-image".getBytes(StandardCharsets.UTF_8)))), task));
        assertThrows(ApiException.class, () -> save(storage, result(List.of(new GeneratedImage(null, "AB==garbage", null))), task));
        assertThrows(ApiException.class, () -> save(storage, result(List.of(encoded(new byte[25 * 1024 * 1024 + 1]))), task));
        assertThrows(ApiException.class, () -> storage.read("/api/images/../../outside.png"));
        assertThrows(ApiException.class, () -> storage.read("/api/images/" + UUID.randomUUID() + "_" + UUID.randomUUID() + ".txt"));
        assertThrows(ApiException.class, () -> save(storage, result(List.of(encoded(png()))), "1-1-1-1-1"));
        assertThrows(ApiException.class, () -> storage.read("/api/images/1-1-1-1-1_" + UUID.randomUUID() + ".png"));
    }

    @Test void downloadsRemoteImageWithoutForwardingCredentials() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var authorizationHeader = new java.util.concurrent.atomic.AtomicReference<String>();
        try {
            server.createContext("/image", exchange -> {
                authorizationHeader.set(exchange.getRequestHeaders().getFirst("Authorization"));
                byte[] raw = png();
                exchange.sendResponseHeaders(200, raw.length);
                exchange.getResponseBody().write(raw);
                exchange.close();
            });
            server.start();
            String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/image";
            ImageStorage storage = storage();
            ImageRecord record = save(storage, result(List.of(new GeneratedImage(null, null, url))), UUID.randomUUID().toString()).getFirst();
            assertArrayEquals(png(), storage.read(record.url()));
            assertNull(authorizationHeader.get());
        } finally {
            server.stop(0);
        }
    }
}
