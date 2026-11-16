package studio.api.task;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.common.ApiException;
import studio.api.common.Json;
import studio.api.common.SecretBox;
import studio.api.provider.GeneratedImage;
import studio.api.provider.ImageProvider;
import studio.api.provider.ProviderResult;
import studio.api.storage.ImageRecord;
import studio.api.storage.ImageStorage;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;

import static org.junit.jupiter.api.Assertions.*;

class TaskStoreTest {
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 1, 2, 3};
    @TempDir Path temp;

    private Fixture fixture() throws Exception {
        Path data = temp.resolve("data");
        Files.createDirectories(data);
        JdbcDataSource source = new JdbcDataSource();
        source.setURL("jdbc:h2:file:" + temp.resolve("tasks").toAbsolutePath().toString().replace('\\', '/') + ";MODE=PostgreSQL;DB_CLOSE_ON_EXIT=FALSE");
        Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(source);
        Json json = new Json(new ObjectMapper());
        SecretBox secrets = new SecretBox(data.toString(), "");
        ImageStorage images = new ImageStorage(data);
        AtomicInteger calls = new AtomicInteger();
        ImageProvider provider = request -> {
            calls.incrementAndGet();
            return new ProviderResult("test-provider", "test-model", "generated " + request.apiKey(),
                    List.of(new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2026-01-01T00:00:00Z");
        };
        return new Fixture(data, source, jdbc, json, secrets, images, provider, calls);
    }

    private TaskStore store(Fixture f) throws Exception {
        TaskStore store = new TaskStore(f.jdbc, new TransactionTemplate(new DataSourceTransactionManager(f.source)), f.json,
                f.secrets, f.provider, f.images, f.data.toString(), true);
        store.initialize();
        return store;
    }

    private GenerationRequest request(Fixture f, String key) {
        ObjectNode params = f.json.object().put("aspectRatio", "1:1");
        String ref = Base64.getEncoder().encodeToString(PNG);
        return new GenerationRequest("gemini-compatible", "test-model", "https://provider.invalid", key,
                params, "a prompt", List.of(new GenerationRequest.ReferenceImage("reference.png", "image/png", ref)));
    }

    private String newId() { return UUID.randomUUID().toString(); }

    private ObjectNode runToTerminal(TaskStore store, String owner, String id) throws Exception {
        store.pump();
        await(() -> {
            try { return List.of("succeeded", "failed").contains(store.get(owner, id).path("status").asText()); }
            catch (RuntimeException e) { return false; }
        });
        return store.get(owner, id);
    }

    private static void await(BooleanSupplier condition) throws Exception {
        long deadline = System.nanoTime() + 8_000_000_000L;
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(20);
        assertTrue(condition.getAsBoolean(), "task did not reach expected state before timeout");
    }

    @Test void idempotencyOwnerIsolationAndDeletedTaskCannotBeReplayed() throws Exception {
        Fixture f = fixture();
        TaskStore store = store(f);
        try {
            String id = newId();
            ObjectNode first = store.create("alice", id, request(f, "key-one"));
            assertEquals(first, store.create("alice", id, request(f, "key-one")));
            ApiException conflict = assertThrows(ApiException.class, () -> store.create("alice", id, request(f, "different-key")));
            assertEquals(409, conflict.status());
            assertEquals(404, assertThrows(ApiException.class, () -> store.get("bob", id)).status());
            assertEquals(404, assertThrows(ApiException.class, () -> store.create("bob", id, request(f, "key-one"))).status());
            runToTerminal(store, "alice", id);
            store.deleteTask("alice", id);
            assertEquals(410, assertThrows(ApiException.class, () -> store.create("alice", id, request(f, "key-one"))).status());
            assertEquals(410, assertThrows(ApiException.class, () -> store.get("alice", id)).status());
        } finally { store.shutdown(); }
    }

    @Test void snapshotIsEncryptedAndPublicTaskAndGalleryNeverExposeCredentialsOrReferenceData() throws Exception {
        Fixture f = fixture();
        TaskStore store = store(f);
        try {
            String id = newId(), key = "secret-provider-key";
            store.create("alice", id, request(f, key));
            String snapshot = f.jdbc.queryForObject("SELECT snapshot FROM tasks WHERE id=?", String.class, id);
            assertNotNull(snapshot);
            assertFalse(snapshot.contains(key));
            assertFalse(snapshot.contains(Base64.getEncoder().encodeToString(PNG)));
            assertEquals(request(f, key), f.json.read(f.secrets.decrypt(snapshot), GenerationRequest.class));

            ObjectNode succeeded = runToTerminal(store, "alice", id);
            String publicJson = f.json.write(succeeded) + f.json.write(store.list("alice")) + f.json.write(store.gallery("alice"));
            assertFalse(publicJson.contains(key));
            assertFalse(publicJson.contains(Base64.getEncoder().encodeToString(PNG)));
            assertTrue(succeeded.path("result").path("images").get(0).path("url").asText().contains(id));
            assertEquals(1, store.gallery("alice").size());
            assertEquals(1, store.stats("alice").get("imageCount"));
            assertEquals(0, store.gallery("bob").size());
            assertEquals(0, store.stats("bob").get("imageCount"));
        } finally { store.shutdown(); }
    }

    @Test void successfulTaskPersistsRawGalleryImageAndDeletingTaskRemovesImageFile() throws Exception {
        Fixture f = fixture();
        TaskStore store = store(f);
        try {
            String id = newId();
            runToTerminal(store, "owner", id = store.create("owner", id, request(f, "key")).path("id").asText());
            ImageRecord image = store.gallery("owner").getFirst();
            Path file = f.data.resolve("images").resolve(image.url().substring("/api/images/".length()));
            assertTrue(Files.exists(file));
            assertArrayEquals(PNG, f.images.read(image.url()));
            assertEquals(PNG.length, image.bytes());
            assertEquals(1, store.deleteTask("owner", id).get("deletedImageCount"));
            assertFalse(Files.exists(file));
            assertTrue(store.gallery("owner").isEmpty());
        } finally { store.shutdown(); }
    }

    @Test void failedTerminalTaskClearsEncryptedSnapshot() throws Exception {
        Fixture f = fixture();
        ImageProvider failing = request -> { f.calls.incrementAndGet(); throw new IllegalStateException("upstream failed"); };
        TaskStore store = store(f, failing);
        try {
            String id = newId();
            store.create("owner", id, request(f, "secret"));
            ObjectNode task = runToTerminal(store, "owner", id);
            assertEquals("failed", task.path("status").asText());
            assertNull(f.jdbc.queryForObject("SELECT snapshot FROM tasks WHERE id=?", String.class, id));
            assertEquals(1, f.calls.get(), "the provider is attempted exactly once before the failure is recorded");
        } finally { store.shutdown(); }
    }

    @Test void restartExecutesQueuedOnceAndFailsInterruptedRunningWithoutResending() throws Exception {
        Fixture f = fixture();
        TaskStore first = store(f);
        String queuedId = newId();
        first.create("owner", queuedId, request(f, "queued-key"));
        first.shutdown();
        TaskStore restarted = store(f);
        try {
            assertEquals("queued", restarted.get("owner", queuedId).path("status").asText());
            assertEquals("succeeded", runToTerminal(restarted, "owner", queuedId).path("status").asText());
            assertEquals(1, f.calls.get());
            String runningId = newId();
            restarted.create("owner", runningId, request(f, "running-key"));
            f.jdbc.update("UPDATE tasks SET status='running' WHERE id=?", runningId);
            restarted.shutdown();

            TaskStore afterCrash = store(f);
            try {
                assertEquals("failed", afterCrash.get("owner", runningId).path("status").asText());
                afterCrash.pump();
                Thread.sleep(100);
                assertEquals(1, f.calls.get(), "an interrupted running task must not be resent");
            } finally { afterCrash.shutdown(); }
        } finally {
            // The restarted writer is closed above when this test follows its normal path.
        }
    }

    @Test void startupRetriesDurableImageDeletionQueue() throws Exception {
        Fixture f = fixture();
        String taskId = newId();
        ImageRecord image = f.images.save(new ProviderResult("test-provider", "test-model", null,
                List.of(new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2026-01-01T00:00:00Z"), "prompt", taskId).getFirst();
        Path file = f.data.resolve("images").resolve(image.url().substring("/api/images/".length()));
        assertTrue(Files.exists(file));
        f.jdbc.update("INSERT INTO file_deletions(url) VALUES(?)", image.url());

        TaskStore recovered = store(f);
        try {
            assertFalse(Files.exists(file));
            assertEquals(0, f.jdbc.queryForObject("SELECT COUNT(*) FROM file_deletions WHERE url=?", Integer.class, image.url()));
        } finally { recovered.shutdown(); }
    }

    @Test void persistedCompletionReceiptRecoversWithoutCallingProviderAgain() throws Exception {
        Fixture f = fixture();
        TaskStore first = store(f);
        String id = newId();
        first.create("owner", id, request(f, "receipt-key"));
        first.shutdown();
        ImageRecord saved = f.images.save(new ProviderResult("test-provider", "test-model", null,
                List.of(new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2026-01-01T00:00:00Z"), "a prompt", id).getFirst();
        ObjectNode result = f.json.object().put("provider", "test-provider").put("model", "test-model").put("createdAt", "2026-01-01T00:00:00Z");
        result.putArray("images").addObject().put("mimeType", saved.mimeType()).put("url", saved.url());
        Files.createDirectories(f.data.resolve("completed"));
        Files.writeString(f.data.resolve("completed").resolve(id + ".json"), f.json.write(new TaskStore.Completion(id, result, List.of(saved))));
        TaskStore recovered = store(f);
        try {
            assertEquals("succeeded", recovered.get("owner", id).path("status").asText());
            assertEquals(0, f.calls.get());
            assertEquals(1, recovered.gallery("owner").size());
            assertFalse(Files.exists(f.data.resolve("completed").resolve(id + ".json")));
        } finally { recovered.shutdown(); }
    }

    @Test void wrongEncryptionKeyStopsStartupWithoutDestroyingQueuedSnapshot() throws Exception {
        Fixture f = fixture();
        TaskStore first = store(f);
        String id = newId();
        first.create("owner", id, request(f, "keep-this-key"));
        first.shutdown();
        SecretBox incorrect = new SecretBox(f.data.toString(), Base64.getEncoder().encodeToString(new byte[32]));
        TaskStore broken = new TaskStore(f.jdbc, new TransactionTemplate(new DataSourceTransactionManager(f.source)), f.json,
                incorrect, f.provider, f.images, f.data.toString(), true);
        assertThrows(IllegalStateException.class, broken::initialize);
        assertEquals("queued", f.jdbc.queryForObject("SELECT status FROM tasks WHERE id=?", String.class, id));
        assertNotNull(f.jdbc.queryForObject("SELECT snapshot FROM tasks WHERE id=?", String.class, id));
        assertEquals(0, f.calls.get());
    }

    @Test void deletingOneGalleryImageDeletesTheEntireTaskGroup() throws Exception {
        Fixture f = fixture();
        ImageProvider twoImages = request -> new ProviderResult(request.provider(), request.model(), null,
                List.of(new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null),
                        new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2026-01-01T00:00:00Z");
        TaskStore store = store(f, twoImages);
        try {
            String id = newId();
            store.create("owner", id, request(f, "key"));
            assertEquals("succeeded", runToTerminal(store, "owner", id).path("status").asText());
            var saved = store.gallery("owner");
            assertEquals(2, saved.size());
            assertEquals(2, store.deleteImages("owner", List.of(saved.getFirst().id())));
            assertTrue(store.gallery("owner").isEmpty());
            assertEquals(410, assertThrows(ApiException.class, () -> store.get("owner", id)).status());
            for (var image : saved) assertThrows(ApiException.class, () -> f.images.read(image.url()));
        } finally { store.shutdown(); }
    }

    private TaskStore store(Fixture f, ImageProvider provider) throws Exception {
        TaskStore store = new TaskStore(f.jdbc, new TransactionTemplate(new DataSourceTransactionManager(f.source)), f.json,
                f.secrets, provider, f.images, f.data.toString(), true);
        store.initialize();
        return store;
    }

    private record Fixture(Path data, JdbcDataSource source, JdbcTemplate jdbc, Json json, SecretBox secrets,
                          ImageStorage images, ImageProvider provider, AtomicInteger calls) {}
}
