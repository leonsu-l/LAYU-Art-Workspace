package studio.api.task;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.common.ApiException;
import studio.api.common.Json;
import studio.api.common.DatabaseTransactions;
import studio.api.ops.OpsIssues;
import studio.api.storage.GalleryFiles;
import studio.api.storage.StorageSettings;
import studio.api.storage.R2Client;
import studio.api.storage.R2Bucket;
import studio.api.common.SecretBox;
import studio.api.provider.GeneratedImage;
import studio.api.provider.ImageProvider;
import studio.api.provider.ProviderResult;
import studio.api.storage.ImageRecord;
import studio.api.storage.ImageStorage;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

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
        DataSourceTransactionManager manager = new DataSourceTransactionManager(source);
        TransactionTemplate tx = new TransactionTemplate(manager);
        DatabaseTransactions transactions = new DatabaseTransactions(jdbc, tx);
        StorageSettings settings = new StorageSettings(jdbc, transactions, secrets);
        OpsIssues issues = new OpsIssues(jdbc, manager);
        R2Client r2 = mock(R2Client.class);
        GalleryFiles files = new GalleryFiles(jdbc, transactions, json, settings, images, r2, issues);
        return new Fixture(data, source, jdbc, json, secrets, images, provider, calls, tx, settings, issues, r2, files);
    }

    private TaskStore store(Fixture f) throws Exception {
        return store(f, f.provider);
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
            store.pump();
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
            assertEquals(1L, store.stats("alice").get("imageCount"));
            assertEquals(0, store.gallery("bob").size());
            assertEquals(0L, store.stats("bob").get("imageCount"));
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
        ImageRecord image = f.images.writeResult(new ProviderResult("test-provider", "test-model", null,
                List.of(new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2026-01-01T00:00:00Z"), "prompt", taskId, (record, bytes) -> f.images.writeLocal(record.url(), bytes)).getFirst();
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
        ImageRecord saved = f.images.writeResult(new ProviderResult("test-provider", "test-model", null,
                List.of(new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2026-01-01T00:00:00Z"), "a prompt", id, (image, bytes) -> f.images.writeLocal(image.url(), bytes)).getFirst();
        ObjectNode result = f.json.object().put("provider", "test-provider").put("model", "test-model").put("createdAt", "2026-01-01T00:00:00Z");
        result.putArray("images").addObject().put("mimeType", saved.mimeType()).put("url", saved.url());
        Files.createDirectories(f.data.resolve("completed"));
        ObjectNode receipt = f.json.mapper().valueToTree(new TaskStore.Completion(id, result, List.of(saved)));
        receipt.remove("remoteBuckets");
        ((ObjectNode) receipt.path("images").get(0)).remove(List.of("retentionDays", "expiresAt"));
        Files.writeString(f.data.resolve("completed").resolve(id + ".json"), f.json.write(receipt));
        TaskStore recovered = store(f);
        try {
            assertEquals("succeeded", recovered.get("owner", id).path("status").asText());
            assertEquals(0, f.calls.get());
            assertEquals(1, recovered.gallery("owner").size());
            assertNull(recovered.gallery("owner").getFirst().retentionDays());
            assertNull(recovered.gallery("owner").getFirst().expiresAt());
            assertArrayEquals(PNG, recovered.readImage("owner", saved.url()).bytes());
            assertFalse(Files.exists(f.data.resolve("completed").resolve(id + ".json")));
        } finally { recovered.shutdown(); }
    }

    @Test void stagedRemoteCompletionReceiptRecoversWithoutAnotherProviderCall() throws Exception {
        Fixture f = fixture();
        String bucket = bucket(f, "receipt-test-bucket");
        policy(f, bucket, null);
        when(f.r2.read(any(), anyString())).thenReturn(PNG);
        TaskStore first = store(f);
        String id = newId();
        first.create("owner", id, request(f, "key"));
        first.shutdown();
        ProviderResult generated = new ProviderResult("test-provider", "test-model", null,
                List.of(new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2020-01-01T00:00:00Z");
        GalleryFiles.Saved written = f.files.save(generated, "a prompt", new GalleryFiles.Context(id, "owner", null), f.settings.policy());
        ImageRecord saved = written.images().getFirst();
        assertEquals(Map.of(saved.url(), bucket), written.remoteBuckets());
        assertEquals(1, f.jdbc.queryForObject("SELECT COUNT(*) FROM file_deletions WHERE task_id=? AND staged=TRUE", Integer.class, id));
        ObjectNode result = f.json.object().put("provider", "test-provider").put("model", "test-model").put("createdAt", generated.createdAt());
        result.putArray("images").addObject().put("mimeType", saved.mimeType()).put("url", saved.url());
        Files.writeString(f.data.resolve("completed").resolve(id + ".json"),
                f.json.write(new TaskStore.Completion(id, result, written.images(), written.remoteBuckets())));
        TaskStore recovered = store(f);
        try {
            assertEquals("succeeded", recovered.get("owner", id).path("status").asText());
            assertEquals(0, f.calls.get());
            assertEquals(bucket, f.jdbc.queryForObject("SELECT bucket_id FROM images WHERE task_id=?", String.class, id));
            assertEquals(0, f.jdbc.queryForObject("SELECT COUNT(*) FROM file_deletions WHERE task_id=?", Integer.class, id));
            assertArrayEquals(PNG, recovered.readImage("owner", saved.url()).bytes());
            verify(f.r2, never()).delete(any(), anyString());
        } finally { recovered.shutdown(); }
    }

    @Test void normalWriteUsesPolicyCurrentAfterProviderReturns() throws Exception {
        Fixture f = fixture();
        String oldBucket = bucket(f, "before-billing-bucket");
        String newBucket = bucket(f, "at-write-bucket");
        policy(f, oldBucket, 3);
        ImageProvider provider = request -> {
            f.calls.incrementAndGet();
            policy(f, newBucket, 5);
            return new ProviderResult("test-provider", "test-model", null,
                    List.of(new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2020-01-01T00:00:00Z");
        };
        TaskStore store = store(f, provider);
        try {
            String id = newId();
            store.create("owner", id, request(f, "key"));
            assertEquals("succeeded", runToTerminal(store, "owner", id).path("status").asText());
            assertEquals(newBucket, f.jdbc.queryForObject("SELECT bucket_id FROM images WHERE task_id=?", String.class, id));
            assertEquals(5, store.gallery("owner").getFirst().retentionDays());
            verify(f.r2).put(argThat(bucket -> bucket.id().equals(newBucket)), anyString(), eq("image/png"), any());
            assertEquals(1, f.calls.get());
        } finally { store.shutdown(); }
    }

    @Test void paidResultSurvivesPinAndFinishFailuresUsingLastCommittedTtl() throws Exception {
        Fixture f = fixture();
        String originalBucket = bucket(f, "paid-result-bucket");
        policy(f, originalBucket, 3);
        DatabaseTransactions pinTransactions = mock(DatabaseTransactions.class);
        when(pinTransactions.locked(any())).thenThrow(new CannotCreateTransactionException("simulated pin failure"));
        GalleryFiles files = new GalleryFiles(f.jdbc, pinTransactions, f.json, f.settings, f.images, f.r2, f.issues);
        JdbcTemplate finishDb = spy(f.jdbc);
        AtomicInteger failedFinishes = new AtomicInteger();
        doAnswer(invocation -> {
            if (failedFinishes.getAndIncrement() == 0) throw new DataAccessResourceFailureException("simulated commit failure");
            return invocation.callRealMethod();
        }).when(finishDb).update(startsWith("UPDATE tasks SET status='succeeded'"), any(Object[].class));
        ImageProvider provider = request -> {
            f.calls.incrementAndGet();
            // This change committed before the database outage, while the paid request was in flight.
            policy(f, originalBucket, 30);
            return new ProviderResult("test-provider", "test-model", null,
                    List.of(new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2020-01-01T00:00:00Z");
        };
        TaskStore first = new TaskStore(finishDb, f.tx, f.json, f.secrets, provider, files, f.issues, f.data.toString(), true);
        first.initialize();
        String id = newId();
        long before = System.currentTimeMillis();
        try {
            first.create("owner", id, request(f, "key"));
            first.pump();
            await(() -> failedFinishes.get() == 1);
        } finally { first.shutdown(); }
        long after = System.currentTimeMillis();
        Path receiptPath = f.data.resolve("completed").resolve(id + ".json");
        assertTrue(Files.exists(receiptPath));
        assertEquals("running", f.jdbc.queryForObject("SELECT status FROM tasks WHERE id=?", String.class, id));
        ObjectNode receipt = f.json.object(Files.readString(receiptPath));
        assertTrue(receipt.path("remoteBuckets").isObject());
        assertTrue(receipt.path("remoteBuckets").isEmpty());
        String url = receipt.path("images").get(0).path("url").asText();
        assertEquals(30, receipt.path("images").get(0).path("retentionDays").asInt());
        long expiry = Instant.parse(receipt.path("images").get(0).path("expiresAt").asText()).toEpochMilli();
        assertTrue(expiry >= before + Duration.ofDays(30).toMillis());
        assertTrue(expiry <= after + Duration.ofDays(30).toMillis());
        assertArrayEquals(PNG, f.images.read(url));
        verify(pinTransactions, times(1)).locked(any());
        verify(f.r2, never()).put(any(), anyString(), anyString(), any());
        assertEquals(1, f.calls.get());
        TaskStore recovered = store(f);
        try {
            assertEquals("succeeded", recovered.get("owner", id).path("status").asText());
            assertEquals(1, f.calls.get(), "recovery must not repeat a paid request");
            assertEquals(expiry, f.jdbc.queryForObject("SELECT expires_at FROM tasks WHERE id=?", Long.class, id).longValue());
            assertNull(f.jdbc.queryForObject("SELECT bucket_id FROM images WHERE task_id=?", String.class, id));
            assertArrayEquals(PNG, recovered.readImage("owner", url).bytes());
            assertTrue(f.issues.list(0, 10, "open").issues().stream().anyMatch(i -> i.kind() == OpsIssues.Kind.R2_FALLBACK));
            assertFalse(Files.exists(f.data.resolve("pending-local").resolve(url.substring("/api/images/".length()))));
            assertFalse(Files.exists(receiptPath));
        } finally { recovered.shutdown(); }
    }

    @Test void wrongEncryptionKeyStopsStartupWithoutDestroyingQueuedSnapshot() throws Exception {
        Fixture f = fixture();
        TaskStore first = store(f);
        String id = newId();
        first.create("owner", id, request(f, "keep-this-key"));
        first.shutdown();
        SecretBox incorrect = new SecretBox(f.data.toString(), Base64.getEncoder().encodeToString(new byte[32]));
        TaskStore broken = new TaskStore(f.jdbc, f.tx, f.json, incorrect, f.provider, f.files, f.issues, f.data.toString(), true);
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

    private String bucket(Fixture f, String name) {
        return f.settings.create(f.json.object().put("accountId", "0123456789abcdef0123456789abcdef")
                .put("bucketName", name).put("accessKeyId", "test-access").put("secretAccessKey", "test-secret")).id();
    }

    private void policy(Fixture f, String bucketId, Integer days) {
        ObjectNode input = f.json.object();
        if (bucketId == null) input.putNull("activeBucketId"); else input.put("activeBucketId", bucketId);
        if (days == null) input.putNull("retentionDays"); else input.put("retentionDays", days);
        f.settings.updatePolicy(input);
    }

    @Test void mixedLocationsExpireTogetherAndRetryRemoteDeletionWithoutBlockingLocal() throws Exception {
        Fixture f = fixture();
        String oldBucket = bucket(f, "old-test-bucket"), newBucket = bucket(f, "new-test-bucket");
        policy(f, oldBucket, 3);
        Map<String, byte[]> remote = new ConcurrentHashMap<>();
        AtomicInteger puts = new AtomicInteger();
        AtomicBoolean failDeletes = new AtomicBoolean(true);
        doAnswer(invocation -> {
            R2Bucket b = invocation.getArgument(0);
            String filename = invocation.getArgument(1);
            remote.put(b.id() + "/" + filename, invocation.getArgument(3));
            if (puts.incrementAndGet() == 2) throw new ApiException("NETWORK", "simulated lost PUT response", 502, true);
            return null;
        }).when(f.r2).put(any(), anyString(), anyString(), any());
        when(f.r2.read(any(), anyString())).thenAnswer(invocation -> {
            R2Bucket b = invocation.getArgument(0);
            byte[] bytes = remote.get(b.id() + "/" + invocation.<String>getArgument(1));
            if (bytes == null) throw ApiException.notFound();
            return bytes;
        });
        doAnswer(invocation -> {
            if (failDeletes.get()) throw new ApiException("STORAGE", "simulated delete failure", 502, true);
            R2Bucket b = invocation.getArgument(0);
            remote.remove(b.id() + "/" + invocation.<String>getArgument(1));
            return null;
        }).when(f.r2).delete(any(), anyString());
        ImageProvider provider = request -> {
            f.calls.incrementAndGet();
            return new ProviderResult("test-provider", "test-model", null, List.of(
                    new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null),
                    new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), "2020-01-01T00:00:00Z");
        };
        TaskStore store = store(f, provider);
        try {
            String id = newId();
            long before = System.currentTimeMillis();
            store.create("owner", id, request(f, "key"));
            assertEquals("succeeded", runToTerminal(store, "owner", id).path("status").asText());
            long after = System.currentTimeMillis();
            List<ImageRecord> images = store.gallery("owner");
            assertEquals(2, images.size());
            long expiry = f.jdbc.queryForObject("SELECT expires_at FROM tasks WHERE id=?", Long.class, id);
            assertTrue(expiry >= before + Duration.ofDays(3).toMillis());
            assertTrue(expiry <= after + Duration.ofDays(3).toMillis());
            for (ImageRecord image : images) {
                assertEquals(3, image.retentionDays());
                assertEquals(expiry, Instant.parse(image.expiresAt()).toEpochMilli());
                assertEquals("2020-01-01T00:00:00Z", image.createdAt());
                GalleryFiles.Content content = store.readImage("owner", image.url());
                assertEquals("image/png", content.mimeType());
                assertArrayEquals(PNG, content.bytes());
                assertEquals(404, assertThrows(ApiException.class, () -> store.readImage("other", image.url())).status());
            }
            assertEquals(2, remote.size(), "timed-out PUT may still have reached R2");
            assertEquals(1, f.jdbc.queryForObject("SELECT COUNT(*) FROM images WHERE task_id=? AND bucket_id=?", Integer.class, id, oldBucket));
            assertEquals(1, f.jdbc.queryForObject("SELECT COUNT(*) FROM images WHERE task_id=? AND bucket_id IS NULL", Integer.class, id));
            String serialized = f.json.write(store.get("owner", id)) + f.json.write(images)
                    + f.jdbc.queryForObject("SELECT task_json FROM tasks WHERE id=?", String.class, id)
                    + f.jdbc.queryForList("SELECT image_json FROM images WHERE task_id=?", String.class, id);
            assertFalse(serialized.contains(oldBucket));
            assertFalse(serialized.contains("old-test-bucket"));
            assertFalse(serialized.contains("test-secret"));
            policy(f, newBucket, null);
            assertEquals(409, assertThrows(ApiException.class, () -> f.settings.delete(oldBucket)).status());
            for (ImageRecord image : images) assertArrayEquals(PNG, store.readImage("owner", image.url()).bytes());
            assertEquals(expiry, f.jdbc.queryForObject("SELECT expires_at FROM tasks WHERE id=?", Long.class, id).longValue());
            assertTrue(f.issues.list(0, 100, null).issues().stream().anyMatch(i -> i.kind() == OpsIssues.Kind.R2_FALLBACK));
            f.jdbc.update("UPDATE tasks SET expires_at=? WHERE id=?", System.currentTimeMillis() - 1, id);
            assertTrue(store.list("owner").isEmpty());
            assertTrue(store.gallery("owner").isEmpty());
            assertEquals(0L, store.stats("owner").get("imageCount"));
            assertEquals(0L, store.stats("owner").get("totalBytes"));
            assertEquals(410, assertThrows(ApiException.class, () -> store.get("owner", id)).status());
            assertEquals(404, assertThrows(ApiException.class, () -> store.get("other", id)).status());
            assertEquals(410, assertThrows(ApiException.class, () -> store.create("owner", id, request(f, "key"))).status());
            assertEquals(404, assertThrows(ApiException.class, () -> store.create("other", id, request(f, "key"))).status());
            for (ImageRecord image : images) assertEquals(404, assertThrows(ApiException.class, () -> store.readImage("owner", image.url())).status());
            assertEquals(2, f.jdbc.queryForObject("SELECT COUNT(*) FROM images WHERE task_id=?", Integer.class, id));
            assertEquals(2, remote.size());
            ImageRecord local = images.stream().filter(i -> Files.exists(f.data.resolve("images").resolve(i.url().substring("/api/images/".length())))).findFirst().orElseThrow();
            store.maintainImages();
            assertEquals(0, f.jdbc.queryForObject("SELECT COUNT(*) FROM images WHERE task_id=?", Integer.class, id));
            assertThrows(ApiException.class, () -> f.images.read(local.url()));
            assertEquals(2, remote.size());
            assertEquals(2, f.jdbc.queryForObject("SELECT COUNT(*) FROM file_deletions WHERE task_id=? AND bucket_id=?", Integer.class, id, oldBucket));
            assertTrue(f.issues.list(0, 100, null).issues().stream().anyMatch(i -> i.kind() == OpsIssues.Kind.IMAGE_DELETE_FAILED));
            assertEquals(409, assertThrows(ApiException.class, () -> f.settings.delete(oldBucket)).status());
            failDeletes.set(false);
            store.maintainImages();
            assertTrue(remote.isEmpty());
            assertEquals(1, f.jdbc.queryForObject("SELECT COUNT(*) FROM file_deletions WHERE task_id=? AND not_before>?", Integer.class, id, System.currentTimeMillis()));
            f.jdbc.update("UPDATE file_deletions SET not_before=0 WHERE task_id=?", id);
            store.maintainImages();
            assertEquals(0, f.jdbc.queryForObject("SELECT COUNT(*) FROM file_deletions WHERE task_id=?", Integer.class, id));
            assertEquals(1, f.calls.get());
        } finally { store.shutdown(); }
    }

    @Test void failedPartialBatchIsCleanedAndDoesNotBlockOtherTasks() throws Exception {
        Fixture f = fixture();
        ImageProvider provider = request -> {
            f.calls.incrementAndGet();
            GeneratedImage good = new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null);
            List<GeneratedImage> images = request.apiKey().equals("bad") ? List.of(good, good) : List.of(good);
            return new ProviderResult("test-provider", "test-model", null, images, Instant.now().toString());
        };
        ImageStorage failingLocal = spy(f.images);
        AtomicInteger writes = new AtomicInteger();
        doAnswer(invocation -> {
            if (writes.incrementAndGet() == 2) throw new ApiException("STORAGE", "simulated disk failure", 500, false);
            return invocation.callRealMethod();
        }).when(failingLocal).writeLocal(anyString(), any());
        DatabaseTransactions transactions = new DatabaseTransactions(f.jdbc, f.tx);
        GalleryFiles files = new GalleryFiles(f.jdbc, transactions, f.json, f.settings, failingLocal, f.r2, f.issues);
        TaskStore store = new TaskStore(f.jdbc, f.tx, f.json, f.secrets, provider, files, f.issues, f.data.toString(), true);
        store.initialize();
        try {
            String bad = newId(), good = newId();
            store.create("owner", bad, request(f, "bad"));
            assertEquals("failed", runToTerminal(store, "owner", bad).path("status").asText());
            assertEquals(0, f.jdbc.queryForObject("SELECT COUNT(*) FROM images WHERE task_id=?", Integer.class, bad));
            store.create("owner", good, request(f, "good"));
            assertEquals("succeeded", runToTerminal(store, "owner", good).path("status").asText());
            store.maintainImages();
            assertEquals(0, f.jdbc.queryForObject("SELECT COUNT(*) FROM file_deletions WHERE task_id=?", Integer.class, bad));
            try (var paths = Files.list(f.data.resolve("images"))) {
                assertTrue(paths.noneMatch(path -> path.getFileName().toString().startsWith(bad + "_")));
            }
            assertEquals(1, store.gallery("owner").size());
            assertTrue(f.issues.list(0, 100, null).issues().stream().anyMatch(i -> i.kind() == OpsIssues.Kind.IMAGE_WRITE_FAILED));
            assertEquals(2, f.calls.get());
        } finally { store.shutdown(); }
    }

    private TaskStore store(Fixture f, ImageProvider provider) throws Exception {
        TaskStore store = new TaskStore(f.jdbc, f.tx, f.json, f.secrets, provider, f.files, f.issues, f.data.toString(), true);
        store.initialize();
        return store;
    }

    private record Fixture(Path data, JdbcDataSource source, JdbcTemplate jdbc, Json json, SecretBox secrets,
                          ImageStorage images, ImageProvider provider, AtomicInteger calls, TransactionTemplate tx,
                          StorageSettings settings, OpsIssues issues, R2Client r2, GalleryFiles files) {}
}
