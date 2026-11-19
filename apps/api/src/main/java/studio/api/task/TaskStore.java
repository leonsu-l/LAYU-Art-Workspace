package studio.api.task;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import studio.api.auth.UserPrincipal;
import studio.api.auth.UserDisabledEvent;
import studio.api.channel.ChannelService;
import studio.api.channel.ChannelDisabledEvent;
import studio.api.quota.QuotaService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.common.ApiErrors;
import studio.api.common.ApiException;
import studio.api.common.Json;
import studio.api.common.SecretBox;
import studio.api.provider.ImageProvider;
import studio.api.provider.ProviderResult;
import studio.api.storage.ImageRecord;
import studio.api.storage.GalleryFiles;
import studio.api.ops.OpsIssues;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

@Service
public class TaskStore {
    private static final Logger log = LoggerFactory.getLogger(TaskStore.class);
    private static final DateTimeFormatter TIMESTAMP = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final Json json;
    private final SecretBox secrets;
    private final ImageProvider provider;
    private final GalleryFiles images;
    private final OpsIssues issues;
    private final Path directory;
    private final boolean workerEnabled;
    private final ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();
    private final Set<String> running = ConcurrentHashMap.newKeySet();
    private volatile boolean ready;
    private volatile boolean paused;
    private volatile boolean stopping;
    private FileChannel lockChannel;
    private FileLock lock;
    private QuotaService quotas;
    private ChannelService channels;

    @Autowired
    void configureTeamServices(QuotaService quotas, ChannelService channels) {
        this.quotas = quotas;
        this.channels = channels;
    }

    public TaskStore(JdbcTemplate db, TransactionTemplate tx, Json json, SecretBox secrets, ImageProvider provider,
                     GalleryFiles images, OpsIssues issues, @Value("${studio.data-dir}") String directory,
                     @Value("${studio.worker-enabled:true}") boolean workerEnabled) {
        this.db = db; this.tx = tx; this.json = json; this.secrets = secrets;
        this.provider = provider; this.images = images; this.issues = issues;
        this.directory = Path.of(directory).toAbsolutePath().normalize(); this.workerEnabled = workerEnabled;
    }

    @PostConstruct
    void initialize() throws IOException {
        Files.createDirectories(directory.resolve("completed"));
        lockChannel = FileChannel.open(directory.resolve("writer.lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        try {
            lock = lockChannel.tryLock();
            if (lock == null) throw new IllegalStateException("The data directory already has a running writer");
            mutate(() -> {
                String probe = db.queryForObject("SELECT key_probe FROM runtime_lock WHERE id=1", String.class);
                if (probe == null) db.update("UPDATE runtime_lock SET key_probe=? WHERE id=1", secrets.encrypt("studio-key-check-v1"));
                else if (!secrets.decrypt(probe).equals("studio-key-check-v1")) throw new IllegalStateException("Incorrect persistent encryption key");
                return null;
            });
            recover();
            expireDueTasks();
            for (String id : db.query("SELECT id FROM deleted_tasks", (rs, i) -> rs.getString(1))) removeReceipt(id);
            images.clean(true, null); // cloud availability must not gate startup; first scheduled pass drains R2
            ready = true;
        } catch (RuntimeException | IOException e) {
            if (lock != null) lock.release();
            lockChannel.close();
            throw e;
        }
    }

    /** Serialize short state transitions in the database, not network requests or image downloads. */
    public <T> T mutate(Supplier<T> action) {
        return tx.execute(status -> {
            db.queryForObject("SELECT id FROM runtime_lock WHERE id=1 FOR UPDATE", Integer.class);
            return action.get();
        });
    }

    // Internal snapshot entry point for the original execution regression tests; never exposed over HTTP.
    public ObjectNode create(String owner, String id, GenerationRequest request) {
        if (!RequestParser.UUID_PATTERN.matcher(id).matches()) throw ApiException.validation("任务 ID 必须为 UUID。");
        return mutate(() -> {
            String hash = json.hash(request);
            ObjectNode existing = replay(owner, id, hash);
            return existing != null ? existing : accept(owner, id, request, hash, null, false);
        });
    }

    public ObjectNode submit(UserPrincipal user, JsonNode input) {
        String id = RequestParser.id(input.path("id"));
        String channelId = RequestParser.id(input.path("channelId"));
        String model = RequestParser.text(input.path("model"), "模型", 512);
        String prompt = RequestParser.text(input.path("prompt"), "提示词", 4000);
        RequestParser.object(input.path("params"));
        ObjectNode clientRequest = json.object().put("id", id).put("channelId", channelId).put("model", model).put("prompt", prompt);
        clientRequest.set("params", input.path("params"));
        if (input.has("referenceImages")) clientRequest.set("referenceImages", input.get("referenceImages"));
        String hash = json.hash(clientRequest);
        return mutate(() -> {
            // Replay is checked before re-reading mutable channel settings or charging quota again.
            ObjectNode existing = replay(user.id(), id, hash);
            if (existing != null) return existing;
            var channel = channels.visible(user, channelId);
            GenerationRequest request = channels.snapshot(user, channelId, model, input.path("params"), input.path("prompt"), input.path("referenceImages"));
            return accept(user.id(), id, request, hash, channelId, channel.ownerId() == null);
        });
    }

    private ObjectNode replay(String owner, String id, String hash) {
        if (deleted(owner, id)) throw gone();
        StoredTask existing = find(id);
        if (existing != null) {
            if (!existing.owner.equals(owner)) throw ApiException.notFound();
            if (existing.expired()) throw gone();
            if (!existing.hash.equals(hash)) throw new ApiException("VALIDATION", "任务 ID 已用于不同请求，不能覆盖。", 409, false);
            return existing.task;
        }
        if (db.queryForObject("SELECT COUNT(*) FROM deleted_tasks WHERE id=?", Integer.class, id) > 0) throw ApiException.notFound();
        return null;
    }

    private ObjectNode accept(String owner, String id, GenerationRequest request, String hash, String channelId, boolean shared) {
        if (paused || stopping) throw new ApiException("UNKNOWN", "任务处理已暂停，请检查存储并重启服务。", 503, true);
        int limit = quotas == null ? 100 : quotas.settings().queueLimit();
        if (db.queryForObject("SELECT COUNT(*) FROM tasks WHERE status='queued'", Integer.class) >= limit)
            throw new ApiException("RATE_LIMIT", "任务队列已满，请稍后再提交。", 429, true);
        String day = channelId == null ? null : quotas.reserve(owner, shared);
        String now = now();
        ObjectNode task = json.object().put("id", id).put("status", "queued").put("createdAt", now).put("updatedAt", now)
                .put("provider", request.provider()).put("model", request.model()).put("prompt", request.prompt())
                .put("expectedImageCount", request.provider().equals("openai-compatible") ? request.params().path("n").asInt(1) : 1)
                .put("expectedAspectRatio", ratio(request)).put("referenceImageCount", request.referenceImages().size());
        if (request.provider().equals("openai-compatible")) task.put("requestedSize", request.params().path("size").asText());
        if (channelId != null) task.put("channelId", channelId);
        db.update("INSERT INTO tasks(id,owner_id,status,request_hash,task_json,snapshot,created_at,updated_at,channel_id,quota_day,quota_reserved) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                id, owner, "queued", hash, json.write(task), secrets.encrypt(json.write(request)), now, now, channelId, day, day != null);
        if (channelId != null) db.update("INSERT INTO task_usage(task_id,user_id,channel_id,shared,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                id, owner, channelId, shared, "queued", now, now);
        return task;
    }

    public List<ObjectNode> list(String owner) {
        return db.query("SELECT task_json FROM tasks WHERE owner_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY sequence_no DESC",
                (rs, i) -> json.object(rs.getString(1)), owner, System.currentTimeMillis());
    }
    public ObjectNode get(String owner, String id) {
        StoredTask row = find(id);
        if (row != null && row.owner.equals(owner)) {
            if (row.expired()) throw gone();
            return row.task;
        }
        if (deleted(owner, id)) throw gone();
        throw ApiException.notFound();
    }
    public List<ImageRecord> gallery(String owner) {
        return db.query("SELECT i.image_json FROM images i JOIN tasks t ON i.task_id=t.id WHERE i.owner_id=? " +
                        "AND (t.expires_at IS NULL OR t.expires_at>?) ORDER BY t.sequence_no DESC,i.id",
                (rs, i) -> json.read(rs.getString(1), ImageRecord.class), owner, System.currentTimeMillis());
    }
    public Integer retentionDays() { return images.policy().retentionDays(); }
    public GalleryFiles.Content readImage(String owner, String url) { return images.read(owner, url); }
    public Map<String, Long> stats(String owner) {
        return db.queryForObject("SELECT COALESCE(SUM(i.bytes),0),COUNT(*) FROM images i JOIN tasks t ON t.id=i.task_id " +
                        "WHERE i.owner_id=? AND (t.expires_at IS NULL OR t.expires_at>?)",
                (rs, n) -> Map.of("totalBytes", rs.getLong(1), "imageCount", rs.getLong(2)), owner, System.currentTimeMillis());
    }
    public Map<String, Integer> deleteTask(String owner, String id) { return delete(owner, List.of(id), List.of()); }
    public int deleteImages(String owner, List<String> ids) { return delete(owner, List.of(), ids).get("deletedImageCount"); }

    private Map<String, Integer> delete(String owner, List<String> taskIds, List<String> imageIds) {
        DeletedGroups result = mutate(() -> {
            var selected = new LinkedHashSet<>(taskIds);
            for (String id : imageIds) {
                selected.addAll(db.query("SELECT task_id FROM images WHERE owner_id=? AND id=?", (rs, i) -> rs.getString(1), owner, id));
            }
            var targets = new ArrayList<StoredTask>();
            for (String id : selected) {
                StoredTask task = find(id);
                if (task == null || !task.owner.equals(owner)) continue;
                if (task.status.equals("queued") || task.status.equals("running"))
                    throw new ApiException("VALIDATION", "排队或生成中的任务不能删除，请等待结束。", 409, false);
                targets.add(task);
            }
            int count = 0;
            for (StoredTask task : targets) count += deleteGroup(task.id, task.owner, task.channelId);
            return new DeletedGroups(targets.stream().map(StoredTask::id).toList(), count);
        });
        for (String id : result.ids) {
            removeReceipt(id);
            images.clean(true, id); // do not keep an HTTP request open for remote delete retries
        }
        return Map.of("deletedTaskCount", result.ids.size(), "deletedImageCount", result.count);
    }
    private record DeletedGroups(List<String> ids, int count) {}

    /** Manual deletion and expiry have the same group boundary and never modify quota/usage history. */
    private int deleteGroup(String id, String owner, String channelId) {
        db.update("INSERT INTO file_deletions(url,bucket_id,task_id,owner_id,channel_id) " +
                "SELECT url,bucket_id,task_id,owner_id,? FROM images WHERE task_id=?", channelId, id);
        int count = db.update("DELETE FROM images WHERE task_id=?", id);
        db.update("INSERT INTO deleted_tasks(id,owner_id) VALUES(?,?)", id, owner);
        db.update("DELETE FROM tasks WHERE id=?", id);
        return count;
    }

    @Scheduled(fixedDelayString = "${studio.worker-poll-ms:250}")
    public synchronized void pump() {
        if (!ready || !workerEnabled || paused || stopping) return;
        try {
            var settings = quotas == null ? new QuotaService.Settings(null, 1, 1, 100) : quotas.settings();
            while (running.size() < settings.globalConcurrency() && !paused && !stopping) {
                StoredTask task = mutate(() -> {
                    // Reference-image snapshots can be tens of MiB. Never load the whole queue into memory.
                    var queued = db.query("SELECT id,owner_id,channel_id,status,snapshot IS NOT NULL AS has_snapshot FROM tasks WHERE status='queued' ORDER BY sequence_no", this::pending);
                    for (PendingTask candidate : queued) {
                        if (candidate.channelId != null && !allowedToStart(candidate.owner, candidate.channelId)) {
                            fail(candidate.id, new ApiException("AUTH", "用户或渠道已停用，任务未执行，站内额度已返还。", 403, false));
                            continue;
                        }
                        int userRunning = db.queryForObject("SELECT COUNT(*) FROM tasks WHERE owner_id=? AND status='running'", Integer.class, candidate.owner);
                        if (userRunning >= settings.perUserConcurrency()) continue;
                        StoredTask next = find(candidate.id, true);
                        next.task.put("status", "running").put("updatedAt", now());
                        db.update("UPDATE tasks SET status='running',task_json=?,updated_at=? WHERE id=? AND status='queued'",
                                json.write(next.task), next.task.path("updatedAt").asText(), next.id);
                        db.update("UPDATE task_usage SET status='running',updated_at=? WHERE task_id=?", now(), next.id);
                        return next;
                    }
                    return null;
                });
                if (task == null) return;
                running.add(task.id);
                workers.submit(() -> {
                    try { execute(task); }
                    catch (Exception e) { pauseForPersistence(); }
                    finally { running.remove(task.id); }
                });
            }
        } catch (Exception e) { pauseForPersistence(); }
    }

    private boolean allowedToStart(String owner, String channelId) {
        return db.queryForObject("SELECT COUNT(*) FROM app_users WHERE id=? AND enabled=TRUE", Integer.class, owner) == 1
                && db.queryForObject("SELECT COUNT(*) FROM channels WHERE id=? AND enabled=TRUE", Integer.class, channelId) == 1;
    }
    @EventListener
    public void disabled(UserDisabledEvent event) { cancelQueued("owner_id", event.userId()); }
    @EventListener
    public void disabled(ChannelDisabledEvent event) { cancelQueued("channel_id", event.channelId()); }
    private void cancelQueued(String column, String id) {
        mutate(() -> {
            // Column is chosen only by the two fixed internal event handlers, never by request input.
            var queued = db.query("SELECT id FROM tasks WHERE status='queued' AND " + column + "=?", (rs, i) -> rs.getString(1), id);
            for (String task : queued) fail(task, new ApiException("AUTH", "用户或渠道已停用，任务未执行，站内额度已返还。", 403, false));
            return null;
        });
    }

    private void execute(StoredTask task) throws IOException {
        GenerationRequest request;
        Completion completion;
        try {
            request = json.read(secrets.decrypt(task.snapshot), GenerationRequest.class);
            if (task.channelId != null && !allowedToStart(task.owner, task.channelId)) {
                fail(task.id, new ApiException("AUTH", "用户或渠道已停用，任务未请求上游，站内额度已返还。", 403, false));
                return;
            }
            var beforeBilling = images.policy(); // fallback retention if the database goes down during generation
            ProviderResult generated = provider.generate(request);
            var saved = images.save(generated, request.prompt(), new GalleryFiles.Context(task.id, task.owner, task.channelId), beforeBilling);
            ObjectNode result = json.object().put("provider", request.provider()).put("model", request.model()).put("createdAt", generated.createdAt());
            if (generated.text() != null && !generated.text().isBlank()) result.put("text", redact(generated.text(), request.apiKey()));
            var entries = result.putArray("images");
            saved.images().forEach(image -> entries.addObject().put("mimeType", image.mimeType()).put("url", image.url())
                    .put("retentionDays", image.retentionDays()).put("expiresAt", image.expiresAt()));
            completion = new Completion(task.id, result, saved.images(), saved.remoteBuckets(), saved.fallbacks());
        } catch (Exception e) {
            ApiException failure = e instanceof ApiException api ? api : new ApiException("UNKNOWN", "生成或保存图片失败，请检查渠道与存储后手动重试。", 502, true);
            fail(task.id, failure);
            if (!failure.code().equals("STORAGE"))
                issues.record(OpsIssues.Kind.GENERATION_FAILED, task.id, task.owner, task.channelId, null, failure.code());
            images.clean(true, task.id);
            return;
        }
        // A paid result must survive a database outage. Keep files and receipt on commit failure.
        writeReceipt(completion);
        finish(completion);
        removeReceipt(task.id);
    }

    private void finish(Completion completion) {
        GalleryFiles.Context committed = mutate(() -> {
            StoredTask task = find(completion.id);
            if (task == null || task.status.equals("succeeded") || task.status.equals("failed")) return null;
            if (!completion.id.equals(task.id) || completion.images == null || completion.images.isEmpty()) throw new IllegalStateException("Invalid completion receipt");
            task.task.put("status", "succeeded").put("updatedAt", now()).set("result", completion.result);
            task.task.remove("error");
            String expiry = completion.images.getFirst().expiresAt();
            Long expiresAt = expiry == null ? null : Instant.parse(expiry).toEpochMilli();
            db.update("UPDATE tasks SET status='succeeded',task_json=?,snapshot=NULL,write_bucket_id=NULL,expires_at=?,quota_reserved=FALSE,updated_at=? WHERE id=?",
                    json.write(task.task), expiresAt, task.task.path("updatedAt").asText(), task.id);
            db.update("UPDATE task_usage SET status='succeeded',updated_at=? WHERE task_id=?", now(), task.id);
            var context = new GalleryFiles.Context(task.id, task.owner, task.channelId);
            for (ImageRecord image : completion.images) {
                if (!image.url().startsWith("/api/images/" + task.id + "_")) throw new IllegalStateException("Receipt image belongs to another task");
                images.publish(image, context, completion.remoteBuckets == null ? null : completion.remoteBuckets.get(image.url()));
            }
            images.abandon(task.id); // leftover remote attempts may still need deletion after a fallback
            return context;
        });
        if (committed != null) images.reportFallbacks(committed, completion.fallbacks);
    }

    public void fail(String id, ApiException failure) {
        mutate(() -> {
            StoredTask task = find(id, true);
            if (task == null || task.status.equals("succeeded") || task.status.equals("failed")) return null;
            String message = failure.getMessage();
            if (task.snapshot != null) {
                try { message = redact(message, json.read(secrets.decrypt(task.snapshot), GenerationRequest.class).apiKey()); }
                catch (Exception ignored) { message = "任务执行失败，无法读取凭据快照。请检查持久化加密密钥。"; }
            }
            var safe = new ApiException(failure.code(), message, failure.status(), failure.retryable());
            task.task.put("status", "failed").put("updatedAt", now()).set("error", json.mapper().valueToTree(ApiErrors.error(safe)));
            if (task.quotaReserved) {
                if (quotas == null) throw new IllegalStateException("Quota service required to release a reservation");
                quotas.refund(task.owner, task.quotaDay);
            }
            images.abandon(id);
            db.update("UPDATE tasks SET status='failed',task_json=?,snapshot=NULL,write_bucket_id=NULL,quota_reserved=FALSE,updated_at=? WHERE id=?",
                    json.write(task.task), task.task.path("updatedAt").asText(), id);
            db.update("UPDATE task_usage SET status='failed',updated_at=? WHERE task_id=?", now(), id);
            return null;
        });
    }

    private void recover() throws IOException {
        var unfinished = db.query("SELECT id,owner_id,channel_id,status,snapshot IS NOT NULL AS has_snapshot FROM tasks WHERE status IN ('queued','running')", this::pending);
        for (PendingTask task : unfinished) {
            Path receipt = receiptPath(task.id);
            if (Files.exists(receipt)) {
                Completion completion = json.read(Files.readString(receipt), Completion.class);
                if (!task.id.equals(completion.id)) throw new IllegalStateException("Completion receipt does not match its task");
                finish(completion);
                removeReceipt(task.id);
            } else if (task.status.equals("running") || !task.hasSnapshot) {
                fail(task.id, new ApiException("UNKNOWN", "后端重启中断了任务，供应商可能已经扣费；不会自动重复请求。", 502, false));
                issues.record(OpsIssues.Kind.GENERATION_FAILED, task.id, task.owner, task.channelId, null, "UNKNOWN");
            }
        }
    }
    @Scheduled(fixedDelay = 300000)
    public void maintainImages() {
        if (!ready || stopping) return;
        expireDueTasks();
        images.clean(true, null);
        images.clean(false, null);
    }
    private void expireDueTasks() {
        while (true) {
            var expired = mutate(() -> {
                var batch = db.query("SELECT id,owner_id,channel_id FROM tasks WHERE expires_at<=? ORDER BY expires_at,id LIMIT 100",
                        (rs, n) -> new GalleryFiles.Context(rs.getString(1), rs.getString(2), rs.getString(3)), System.currentTimeMillis());
                for (var t : batch) deleteGroup(t.taskId(), t.ownerId(), t.channelId());
                return batch;
            });
            for (var t : expired) removeReceipt(t.taskId());
            if (expired.size() < 100) return;
        }
    }
    private void writeReceipt(Completion completion) throws IOException {
        Path destination = receiptPath(completion.id);
        Path temporary = destination.resolveSibling(destination.getFileName() + ".tmp");
        try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
            var bytes = ByteBuffer.wrap(json.mapper().writeValueAsBytes(completion));
            while (bytes.hasRemaining()) channel.write(bytes);
            channel.force(true);
        }
        try { Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
        catch (AtomicMoveNotSupportedException e) { Files.move(temporary, destination, StandardCopyOption.REPLACE_EXISTING); }
    }
    private Path receiptPath(String id) {
        if (!RequestParser.UUID_PATTERN.matcher(id).matches()) throw new IllegalArgumentException("Invalid task identifier");
        return directory.resolve("completed").resolve(id + ".json");
    }
    private void removeReceipt(String id) {
        try { Files.deleteIfExists(receiptPath(id)); }
        catch (IOException e) { log.warn("Could not remove a committed result receipt; preserve the data directory"); }
    }
    private void pauseForPersistence() {
        paused = true;
        log.error("Task processing paused after a persistence failure; check storage and restart. No upstream request will be repeated.");
    }
    private StoredTask find(String id) { return find(id, false); }
    private StoredTask find(String id, boolean includeSnapshot) {
        String columns = includeSnapshot ? "*" : "id,owner_id,status,request_hash,task_json,channel_id,quota_day,quota_reserved,expires_at,NULL AS snapshot";
        var rows = db.query("SELECT " + columns + " FROM tasks WHERE id=?", this::row, id);
        return rows.isEmpty() ? null : rows.getFirst();
    }
    private PendingTask pending(ResultSet rs, int index) throws SQLException {
        return new PendingTask(rs.getString("id"), rs.getString("owner_id"), rs.getString("channel_id"), rs.getString("status"), rs.getBoolean("has_snapshot"));
    }
    private StoredTask row(ResultSet rs, int index) throws SQLException {
        return new StoredTask(rs.getString("id"), rs.getString("owner_id"), rs.getString("status"), rs.getString("request_hash"), rs.getString("snapshot"), json.object(rs.getString("task_json")), rs.getString("channel_id"), rs.getString("quota_day"), rs.getBoolean("quota_reserved"), (Long) rs.getObject("expires_at"));
    }
    private boolean deleted(String owner, String id) {
        return db.queryForObject("SELECT COUNT(*) FROM deleted_tasks WHERE id=? AND owner_id=?", Integer.class, id, owner) > 0;
    }
    private ApiException gone() { return new ApiException("VALIDATION", "此任务已删除，不能恢复或重放。", 410, false); }
    private static String now() { return TIMESTAMP.format(Instant.now()); }
    private static String ratio(GenerationRequest request) {
        String value = request.provider().equals("openai-compatible") ? request.params().path("size").asText() : request.params().path("aspectRatio").asText();
        return value.equals("auto") ? "1:1" : value.replace('x', ':');
    }
    private static String redact(String value, String key) {
        return value.replace(key, "[REDACTED]").replace(java.net.URLEncoder.encode(key, java.nio.charset.StandardCharsets.UTF_8), "[REDACTED]")
                .replaceAll("(?i)([?&](?:key|api_key)=)[^&\\s\"']+", "$1[REDACTED]");
    }

    @PreDestroy
    void shutdown() throws Exception {
        synchronized (this) { stopping = true; }
        workers.shutdown();
        if (!workers.awaitTermination(610, TimeUnit.SECONDS)) {
            workers.shutdownNow();
            workers.awaitTermination(10, TimeUnit.SECONDS);
        }
        if (lock != null && lock.isValid()) lock.release();
        if (lockChannel != null) lockChannel.close();
    }
    private record PendingTask(String id, String owner, String channelId, String status, boolean hasSnapshot) {}
    private record StoredTask(String id, String owner, String status, String hash, String snapshot, ObjectNode task,
                              String channelId, String quotaDay, boolean quotaReserved, Long expiresAt) {
        boolean expired() { return expiresAt != null && expiresAt <= System.currentTimeMillis(); }
    }
    /** Internal recovery receipt. Only result and ImageRecord cross the public API boundary. */
    public record Completion(String id, ObjectNode result, List<ImageRecord> images, Map<String,String> remoteBuckets,
                             List<GalleryFiles.Fallback> fallbacks) {
        public Completion(String id, ObjectNode result, List<ImageRecord> images) { this(id, result, images, null, null); }
        public Completion(String id, ObjectNode result, List<ImageRecord> images, Map<String,String> remoteBuckets) {
            this(id, result, images, remoteBuckets, null);
        }
    }
}
