package studio.api.task;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.auth.UserDisabledEvent;
import studio.api.auth.UserPrincipal;
import studio.api.channel.ChannelDisabledEvent;
import studio.api.channel.ChannelService;
import studio.api.channel.ModelCatalog;
import studio.api.common.ApiException;
import studio.api.common.DatabaseTransactions;
import studio.api.common.Json;
import studio.api.common.SecretBox;
import studio.api.provider.GeneratedImage;
import studio.api.provider.ImageProvider;
import studio.api.provider.ProviderResult;
import studio.api.quota.QuotaService;
import studio.api.storage.ImageStorage;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

import static org.junit.jupiter.api.Assertions.*;

class TeamTaskTest {
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 1, 2, 3};
    private static final String MODEL = "test-image-model";
    private static final UserPrincipal ADMIN = new UserPrincipal("00000000-0000-4000-8000-000000000001", "admin", "ADMIN", false);
    private static final UserPrincipal ALICE = new UserPrincipal("00000000-0000-4000-8000-000000000002", "alice", "USER", false);
    private static final UserPrincipal BOB = new UserPrincipal("00000000-0000-4000-8000-000000000003", "bob", "USER", false);

    @TempDir Path temp;

    private Fixture fixture(ImageProvider provider) throws Exception {
        Path data = temp.resolve("data");
        Files.createDirectories(data);
        JdbcDataSource source = new JdbcDataSource();
        source.setURL("jdbc:h2:file:" + temp.resolve("team-tasks").toAbsolutePath().toString().replace('\\', '/') + ";MODE=PostgreSQL;DB_CLOSE_ON_EXIT=FALSE;LOCK_TIMEOUT=15000");
        Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
        JdbcTemplate db = new JdbcTemplate(source);
        DataSourceTransactionManager manager = new DataSourceTransactionManager(source);
        TransactionTemplate tx = new TransactionTemplate(manager);
        Json json = new Json(new ObjectMapper());
        SecretBox secrets = new SecretBox(data.toString(), "");
        DatabaseTransactions transactions = new DatabaseTransactions(db, tx);
        QuotaService quotas = new QuotaService(db, transactions, json);
        AtomicReference<TaskStore> storeRef = new AtomicReference<>();
        ApplicationEventPublisher events = event -> {
            TaskStore store = storeRef.get();
            if (store == null) return;
            if (event instanceof UserDisabledEvent disabled) store.disabled(disabled);
            if (event instanceof ChannelDisabledEvent disabled) store.disabled(disabled);
        };
        ChannelService channels = new ChannelService(db, transactions, json, secrets, new ModelCatalog(json), new RequestParser(json), events);
        ImageStorage images = new ImageStorage(data);
        TaskStore store = new TaskStore(db, tx, json, secrets, provider, images, data.toString(), true);
        store.configureTeamServices(quotas, channels);
        store.initialize();
        storeRef.set(store);
        seedUser(db, ALICE);
        seedUser(db, BOB);
        seedUser(db, ADMIN);
        return new Fixture(data, db, json, secrets, transactions, quotas, channels, store, storeRef);
    }

    private Fixture fixture() throws Exception { return fixture(defaultProvider(new AtomicInteger())); }

    private static ImageProvider defaultProvider(AtomicInteger calls) {
        return request -> {
            calls.incrementAndGet();
            return new ProviderResult("test-provider", request.model(), "ok", List.of(
                    new GeneratedImage("image/png", Base64.getEncoder().encodeToString(PNG), null)), Instant.now().toString());
        };
    }

    private static void seedUser(JdbcTemplate db, UserPrincipal user) {
        db.update("INSERT INTO app_users(id,username,password_hash,role,enabled,must_change_password,daily_limit,created_at) VALUES(?,?,?,?,TRUE,FALSE,NULL,?)",
                user.id(), user.username(), "unused-test-hash", user.role(), Instant.now().toString());
    }

    private ObjectNode settings(Fixture f, Integer defaultLimit, int global, int perUser, int queue) {
        ObjectNode input = f.json.object();
        if (defaultLimit == null) input.putNull("defaultDailyLimit"); else input.put("defaultDailyLimit", defaultLimit);
        return input.put("globalConcurrency", global).put("perUserConcurrency", perUser).put("queueLimit", queue);
    }

    private void configureQuota(Fixture f, Integer limit, int global, int perUser) {
        f.quotas.update(settings(f, limit, global, perUser, 100));
    }

    private String sharedChannel(Fixture f) { return channel(f, ADMIN, "shared", "https://old.example/v1", "old-channel-key"); }
    private String privateChannel(Fixture f, UserPrincipal owner) { return channel(f, owner, "private", "https://private.example/v1", "private-key"); }

    private String channel(Fixture f, UserPrincipal actor, String scope, String baseUrl, String key) {
        ObjectNode input = f.json.object().put("name", scope + " test channel").put("provider", "gemini-compatible")
                .put("scope", scope).put("baseUrl", baseUrl).put("apiKey", key).put("enabled", true);
        input.putArray("enabledModels").add(MODEL);
        return f.channels.create(actor, input).path("id").asText();
    }

    private ObjectNode submission(Fixture f, String id, String channelId, String model) {
        ObjectNode input = f.json.object().put("id", id).put("channelId", channelId).put("model", model).put("prompt", "test prompt");
        input.set("params", f.json.object().put("aspectRatio", "1:1"));
        return input;
    }

    private void await(BooleanSupplier condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(20);
        assertTrue(condition.getAsBoolean(), "task did not reach expected state before timeout");
    }

    private ObjectNode terminal(Fixture f, String ownerId, String id) throws Exception {
        await(() -> {
            try { return List.of("succeeded", "failed").contains(f.store.get(ownerId, id).path("status").asText()); }
            catch (RuntimeException e) { return false; }
        });
        return f.store.get(ownerId, id);
    }

    private void close(Fixture f) throws Exception { f.store.shutdown(); }

    @Test void missingDefaultQuotaBlocksSharedButPrivateChannelDoesNotReserve() throws Exception {
        Fixture f = fixture();
        try {
            String shared = sharedChannel(f);
            ApiException unset = assertThrows(ApiException.class, () -> f.store.submit(ALICE, submission(f, UUID.randomUUID().toString(), shared, MODEL)));
            assertEquals(403, unset.status());
            String privateId = privateChannel(f, ALICE);
            String taskId = UUID.randomUUID().toString();
            f.store.submit(ALICE, submission(f, taskId, privateId, MODEL));
            assertEquals(0, f.quotas.current(ALICE.id()).path("used").asInt());
        } finally { close(f); }
    }

    @Test void defaultQuotaUserOverrideReplayHashAndPrivateUsageRules() throws Exception {
        Fixture f = fixture();
        try {
            configureQuota(f, 4, 2, 1);
            String shared = sharedChannel(f);
            String id = UUID.randomUUID().toString();
            ObjectNode input = submission(f, id, shared, MODEL);
            ObjectNode first = f.store.submit(ALICE, input);
            assertEquals(first, f.store.submit(ALICE, input.deepCopy()));
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
            ObjectNode changed = input.deepCopy();
            changed.set("params", f.json.object().put("aspectRatio", "16:9"));
            assertEquals(409, assertThrows(ApiException.class, () -> f.store.submit(ALICE, changed)).status());
            assertEquals(java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).toString(),
                    f.quotas.current(ALICE.id()).path("date").asText());
            f.db.update("UPDATE app_users SET daily_limit=0 WHERE id=?", BOB.id());
            assertEquals(429, assertThrows(ApiException.class, () -> f.store.submit(BOB, submission(f, UUID.randomUUID().toString(), shared, MODEL))).status());
            f.db.update("UPDATE app_users SET daily_limit=-1 WHERE id=?", BOB.id());
            f.store.submit(BOB, submission(f, UUID.randomUUID().toString(), shared, MODEL));
            assertEquals(1, f.quotas.current(BOB.id()).path("used").asInt());
            String privateId = privateChannel(f, ALICE);
            f.store.submit(ALICE, submission(f, UUID.randomUUID().toString(), privateId, MODEL));
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
        } finally { close(f); }
    }

    @Test void concurrentSubmissionsCannotExceedSharedDailyQuota() throws Exception {
        Fixture f = fixture();
        ExecutorService callers = Executors.newFixedThreadPool(12);
        try {
            configureQuota(f, 3, 2, 2);
            String shared = sharedChannel(f);
            CountDownLatch ready = new CountDownLatch(12), start = new CountDownLatch(1);
            var attempts = new java.util.ArrayList<java.util.concurrent.Future<Boolean>>();
            for (int i = 0; i < 12; i++) {
                final String id = UUID.randomUUID().toString();
                attempts.add(callers.submit(() -> {
                    ready.countDown();
                    start.await();
                    try { f.store.submit(ALICE, submission(f, id, shared, MODEL)); return true; }
                    catch (ApiException e) { if (e.status() == 429) return false; throw e; }
                }));
            }
            assertTrue(ready.await(3, TimeUnit.SECONDS));
            start.countDown();
            int accepted = 0;
            for (var attempt : attempts) if (attempt.get(8, TimeUnit.SECONDS)) accepted++;
            assertEquals(3, accepted);
            assertEquals(3, f.quotas.current(ALICE.id()).path("used").asInt());
            assertEquals(3, f.db.queryForObject("SELECT COUNT(*) FROM tasks WHERE owner_id=?", Integer.class, ALICE.id()));
        } finally { callers.shutdownNow(); close(f); }
    }

    @Test void successDoesNotRefundButFailureAndRepeatedFailureRefundExactlyOnce() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        ImageProvider provider = request -> {
            calls.incrementAndGet();
            if (request.prompt().contains("fail")) throw new ApiException("NETWORK", "upstream timeout", 502, true);
            return defaultProvider(new AtomicInteger()).generate(request);
        };
        Fixture f = fixture(provider);
        try {
            configureQuota(f, 5, 2, 1);
            String shared = sharedChannel(f);
            String success = UUID.randomUUID().toString();
            f.store.submit(ALICE, submission(f, success, shared, MODEL));
            f.store.pump();
            assertEquals("succeeded", terminal(f, ALICE.id(), success).path("status").asText());
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
            f.store.deleteTask(ALICE.id(), success);
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());

            String failure = UUID.randomUUID().toString();
            f.store.submit(ALICE, submission(f, failure, shared, MODEL).put("prompt", "please fail"));
            f.store.pump();
            assertEquals("failed", terminal(f, ALICE.id(), failure).path("status").asText());
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
            f.store.fail(failure, new ApiException("UNKNOWN", "duplicate failure", 502, true));
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
            assertEquals(2, calls.get());
        } finally { close(f); }
    }

    @Test void disablingChannelCancelsQueuedTaskButLetsAlreadyRunningTaskFinish() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        ImageProvider provider = request -> {
            entered.countDown();
            try { if (!release.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("test provider timed out"); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            return defaultProvider(new AtomicInteger()).generate(request);
        };
        Fixture f = fixture(provider);
        try {
            configureQuota(f, 5, 2, 1);
            String shared = sharedChannel(f);
            String running = UUID.randomUUID().toString();
            f.store.submit(ALICE, submission(f, running, shared, MODEL));
            f.store.pump();
            assertTrue(entered.await(3, TimeUnit.SECONDS));
            String queued = UUID.randomUUID().toString();
            f.store.submit(ALICE, submission(f, queued, shared, MODEL));
            ObjectNode update = f.json.object().put("name", "disabled shared").put("provider", "gemini-compatible")
                    .put("baseUrl", "https://old.example/v1").put("apiKey", "old-channel-key").put("enabled", false);
            update.putArray("enabledModels").add(MODEL);
            f.channels.update(ADMIN, shared, update);
            assertEquals("failed", f.store.get(ALICE.id(), queued).path("status").asText());
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
            release.countDown();
            assertEquals("succeeded", terminal(f, ALICE.id(), running).path("status").asText());
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
        } finally { release.countDown(); close(f); }
    }

    @Test void disablingUserCancelsQueuedReservationButLetsRunningTaskFinish() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        ImageProvider provider = request -> {
            entered.countDown();
            try { if (!release.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("test provider timed out"); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            return defaultProvider(new AtomicInteger()).generate(request);
        };
        Fixture f = fixture(provider);
        try {
            configureQuota(f, 5, 2, 1);
            String shared = sharedChannel(f);
            String running = UUID.randomUUID().toString(), queued = UUID.randomUUID().toString();
            f.store.submit(ALICE, submission(f, running, shared, MODEL));
            f.store.pump();
            assertTrue(entered.await(3, TimeUnit.SECONDS));
            f.store.submit(ALICE, submission(f, queued, shared, MODEL));
            f.db.update("UPDATE app_users SET enabled=FALSE WHERE id=?", ALICE.id());
            f.store.disabled(new UserDisabledEvent(ALICE.id()));
            assertEquals("failed", f.store.get(ALICE.id(), queued).path("status").asText());
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
            release.countDown();
            assertEquals("succeeded", terminal(f, ALICE.id(), running).path("status").asText());
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
        } finally { release.countDown(); close(f); }
    }

    @Test void replayUsesOriginalChannelSnapshotAfterKeyAndBaseUrlChange() throws Exception {
        AtomicReference<GenerationRequest> generated = new AtomicReference<>();
        ImageProvider provider = request -> {
            generated.set(request);
            return defaultProvider(new AtomicInteger()).generate(request);
        };
        Fixture f = fixture(provider);
        try {
            configureQuota(f, 5, 2, 1);
            String shared = sharedChannel(f), id = UUID.randomUUID().toString();
            ObjectNode input = submission(f, id, shared, MODEL);
            ObjectNode original = f.store.submit(ALICE, input);
            ObjectNode update = f.json.object().put("name", "rotated key").put("provider", "gemini-compatible")
                    .put("baseUrl", "https://new.example/v2").put("apiKey", "new-channel-key").put("enabled", true);
            update.putArray("enabledModels").add(MODEL);
            f.channels.update(ADMIN, shared, update);
            assertEquals(original, f.store.submit(ALICE, input.deepCopy()));
            f.store.pump();
            assertEquals("succeeded", terminal(f, ALICE.id(), id).path("status").asText());
            assertEquals("https://old.example/v1", generated.get().baseUrl());
            assertEquals("old-channel-key", generated.get().apiKey());
            assertEquals(1, f.quotas.current(ALICE.id()).path("used").asInt());
        } finally { close(f); }
    }

    @Test void privateChannelCannotBeSubmittedByAnotherOwner() throws Exception {
        Fixture f = fixture();
        try {
            String channel = privateChannel(f, ALICE);
            assertEquals(404, assertThrows(ApiException.class,
                    () -> f.store.submit(BOB, submission(f, UUID.randomUUID().toString(), channel, MODEL))).status());
        } finally { close(f); }
    }

    @Test void globalConcurrencyStartsTwoTasksAndPerUserLimitKeepsSecondQueued() throws Exception {
        CountDownLatch entered = new CountDownLatch(2), release = new CountDownLatch(1);
        ImageProvider provider = request -> {
            entered.countDown();
            try { if (!release.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("test provider timed out"); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            return defaultProvider(new AtomicInteger()).generate(request);
        };
        Fixture f = fixture(provider);
        try {
            configureQuota(f, 10, 2, 1);
            String shared = sharedChannel(f);
            String aliceOne = UUID.randomUUID().toString(), aliceTwo = UUID.randomUUID().toString(), bobOne = UUID.randomUUID().toString();
            f.store.submit(ALICE, submission(f, aliceOne, shared, MODEL));
            f.store.submit(ALICE, submission(f, aliceTwo, shared, MODEL));
            f.store.submit(BOB, submission(f, bobOne, shared, MODEL));
            f.store.pump();
            assertTrue(entered.await(3, TimeUnit.SECONDS), "global concurrency should permit two upstream requests");
            assertEquals("running", f.store.get(ALICE.id(), aliceOne).path("status").asText());
            assertEquals("queued", f.store.get(ALICE.id(), aliceTwo).path("status").asText());
            assertEquals("running", f.store.get(BOB.id(), bobOne).path("status").asText());
            release.countDown();
            assertEquals("succeeded", terminal(f, ALICE.id(), aliceOne).path("status").asText());
            await(() -> {
                f.store.pump();
                return !"queued".equals(f.store.get(ALICE.id(), aliceTwo).path("status").asText());
            });
            assertEquals("succeeded", terminal(f, ALICE.id(), aliceTwo).path("status").asText());
            assertEquals("succeeded", terminal(f, BOB.id(), bobOne).path("status").asText());
        } finally { release.countDown(); close(f); }
    }

    private record Fixture(Path data, JdbcTemplate db, Json json, SecretBox secrets, DatabaseTransactions transactions,
                           QuotaService quotas, ChannelService channels, TaskStore store, AtomicReference<TaskStore> storeRef) {}
}
