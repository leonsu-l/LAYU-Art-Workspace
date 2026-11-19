package studio.api.storage;

import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.TransactionException;
import org.springframework.stereotype.Service;
import studio.api.common.ApiException;
import studio.api.common.DatabaseTransactions;
import studio.api.common.Json;
import studio.api.ops.OpsIssues;
import studio.api.provider.ProviderResult;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Routes private objects by their recorded location, never by the current write setting. */
@Service
public class GalleryFiles {
    private final JdbcTemplate db;
    private final DatabaseTransactions transactions;
    private final Json json;
    private final StorageSettings settings;
    private final ImageStorage local;
    private final R2Client r2;
    private final OpsIssues issues;

    public GalleryFiles(JdbcTemplate db, DatabaseTransactions transactions, Json json, StorageSettings settings,
                        ImageStorage local, R2Client r2, OpsIssues issues) {
        this.db = db; this.transactions = transactions; this.json = json; this.settings = settings;
        this.local = local; this.r2 = r2; this.issues = issues;
    }

    public StorageSettings.Policy policy() { return settings.policy(); }
    public record Context(String taskId, String ownerId, String channelId) {}
    public record Content(String mimeType, byte[] bytes) {}
    public record Fallback(String bucketId, String errorCode) {}
    public record Saved(List<ImageRecord> images, Map<String,String> remoteBuckets, List<Fallback> fallbacks) {}

    public Saved save(ProviderResult result, String prompt, Context task, StorageSettings.Policy beforeBilling) {
        StorageSettings.Policy policy;
        boolean online = true;
        try {
            // Select at save time, not at submission. Pin the bucket until the receipt is committed.
            policy = transactions.locked(() -> {
                var p = settings.policy();
                db.update("UPDATE tasks SET write_bucket_id=? WHERE id=?", p.bucketId(), task.taskId());
                return p;
            });
        } catch (DataAccessException | TransactionException unavailable) {
            policy = settings.lastKnown(beforeBilling);
            online = false; // cannot safely issue a PUT without a durable intent and bucket reference
        }
        var writer = new BatchWriter(task, policy.bucketId(), online);
        List<ImageRecord> images;
        try {
            images = local.writeResult(result, prompt, task.taskId(), writer::write);
        } catch (RuntimeException failure) {
            reportFallbacks(task, writer.fallbacks);
            throw failure;
        }
        if (policy.retentionDays() != null) {
            int days = policy.retentionDays();
            String expiry = Instant.ofEpochMilli(System.currentTimeMillis()).plus(days, ChronoUnit.DAYS).toString();
            images = images.stream().map(image -> image.withExpiry(days, expiry)).toList();
        }
        return new Saved(images, Map.copyOf(writer.remoteBuckets), List.copyOf(writer.fallbacks));
    }

    private final class BatchWriter {
        final Context task;
        final String bucketId;
        boolean online;
        final Map<String,String> remoteBuckets = new HashMap<>();
        final List<Fallback> fallbacks = new ArrayList<>();
        BatchWriter(Context task, String bucketId, boolean online) { this.task = task; this.bucketId = bucketId; this.online = online; }

        void write(ImageRecord image, byte[] bytes) {
            String url = image.url();
            if (bucketId != null) {
                if (stage(url, bucketId)) {
                    try {
                        r2.put(settings.bucket(bucketId), local.filename(url), image.mimeType(), bytes);
                        remoteBuckets.put(url, bucketId);
                        return;
                    } catch (RuntimeException failure) {
                        // The PUT may have reached R2. Keep its intent even if the local fallback succeeds.
                        fallbacks.add(new Fallback(bucketId, code(failure)));
                    }
                } else fallbacks.add(new Fallback(bucketId, "STORAGE"));
            }
            try {
                if (!stage(url, null)) local.markLocal(url);
                local.writeLocal(url, bytes);
            } catch (RuntimeException failure) {
                report(OpsIssues.Kind.IMAGE_WRITE_FAILED, task, bucketId, code(failure));
                throw new ApiException("STORAGE", "图片保存失败。", 500, false);
            }
        }
        boolean stage(String url, String location) {
            if (!online) return false;
            try {
                db.update("INSERT INTO file_deletions(url,bucket_id,task_id,owner_id,channel_id,staged) VALUES(?,?,?,?,?,TRUE)",
                        url, location, task.taskId(), task.ownerId(), task.channelId());
                return true;
            } catch (DataAccessException unavailable) {
                online = false;
                return false;
            }
        }
    }

    public void reportFallbacks(Context task, List<Fallback> fallbacks) {
        if (fallbacks != null) for (var f : fallbacks) report(OpsIssues.Kind.R2_FALLBACK, task, f.bucketId(), f.errorCode());
    }

    /** Called inside the task-completion transaction. Only the receipt's actual location becomes live. */
    public void publish(ImageRecord image, Context task, String bucketId) {
        db.update("INSERT INTO images(id,task_id,owner_id,url,bytes,image_json,bucket_id) VALUES(?,?,?,?,?,?,?)",
                image.id(), task.taskId(), task.ownerId(), image.url(), image.bytes(), json.write(image), bucketId);
        String sql = "DELETE FROM file_deletions WHERE staged=TRUE AND task_id=? AND url=? AND ";
        if (bucketId == null) db.update(sql + "bucket_id IS NULL", task.taskId(), image.url());
        else db.update(sql + "bucket_id=?", task.taskId(), image.url(), bucketId);
    }

    /** Release any unpublished attempts (including an uncertain PUT on an otherwise successful task).
     * Recheck uncertain remote keys after the first delete, in case the PUT was still in flight. */
    public void abandon(String taskId) {
        long verifyAfter = System.currentTimeMillis() + java.time.Duration.ofDays(1).toMillis();
        db.update("UPDATE file_deletions SET staged=FALSE, verify_after=CASE WHEN bucket_id IS NULL THEN NULL ELSE CAST(? AS BIGINT) END WHERE task_id=? AND staged=TRUE",
                verifyAfter, taskId);
    }

    public Content read(String owner, String url) {
        var rows = db.query("SELECT i.image_json,i.bucket_id,i.task_id,t.channel_id FROM images i JOIN tasks t ON t.id=i.task_id " +
                        "WHERE i.owner_id=? AND i.url=? AND (t.expires_at IS NULL OR t.expires_at>?)",
                (rs, n) -> new Located(json.read(rs.getString(1), ImageRecord.class), rs.getString(2), new Context(rs.getString(3), owner, rs.getString(4))),
                owner, url, System.currentTimeMillis());
        if (rows.isEmpty()) throw ApiException.notFound(); // No existence oracle and no alerts for expired/foreign/random URLs.
        var file = rows.getFirst();
        try {
            byte[] bytes = file.bucketId == null ? local.read(url) : r2.read(settings.bucket(file.bucketId), local.filename(url));
            return new Content(file.image.mimeType(), bytes);
        } catch (RuntimeException failure) {
            report(OpsIssues.Kind.IMAGE_READ_FAILED, file.task, file.bucketId, code(failure));
            if (failure instanceof ApiException api && api.status() == 404) throw ApiException.notFound();
            throw new ApiException("STORAGE", "图片暂时无法读取。", 503, true);
        }
    }
    private record Located(ImageRecord image, String bucketId, Context task) {}

    /** Drain outside runtime_lock. Keyset paging attempts each eligible object once per pass,
     * so one inaccessible old bucket cannot starve newer objects or block logical deletion. */
    public void clean(boolean localOnly, String taskId) {
        if (localOnly && taskId == null) reconcileLocalMarkers();
        long after = 0, now = System.currentTimeMillis();
        String sql = "SELECT id,url,bucket_id,task_id,owner_id,channel_id,verify_after FROM file_deletions WHERE staged=FALSE AND id>? AND not_before<=?" +
                (localOnly ? " AND bucket_id IS NULL" : " AND bucket_id IS NOT NULL") + (taskId == null ? "" : " AND task_id=?") + " ORDER BY id LIMIT 100";
        while (true) {
            var batch = db.query(sql, (rs, n) -> new Deletion(rs.getLong(1), rs.getString(2), rs.getString(3),
                    new Context(rs.getString(4), rs.getString(5), rs.getString(6)), (Long) rs.getObject(7)), taskId == null ? new Object[]{after, now} : new Object[]{after, now, taskId});
            for (Deletion item : batch) {
                after = item.id;
                try {
                    if (item.bucketId == null) local.remove(item.url);
                    else r2.delete(settings.bucket(item.bucketId), local.filename(item.url));
                } catch (RuntimeException failure) {
                    report(OpsIssues.Kind.IMAGE_DELETE_FAILED, item.task, item.bucketId, code(failure));
                    continue; // retain the intent and bucket reference until physical deletion succeeds
                }
                if (item.verifyAfter != null && item.verifyAfter > now)
                    db.update("UPDATE file_deletions SET not_before=?,verify_after=NULL WHERE id=?", item.verifyAfter, item.id);
                else db.update("DELETE FROM file_deletions WHERE id=?", item.id);
            }
            if (batch.size() < 100) return;
        }
    }
    private record Deletion(long id, String url, String bucketId, Context task, Long verifyAfter) {}

    private void reconcileLocalMarkers() {
        for (String url : local.markedLocal()) {
            String taskId = local.filename(url).substring(0, 36);
            // A running task may still be writing a receipt. A terminal task cannot go back to running.
            if (db.queryForObject("SELECT COUNT(*) FROM tasks WHERE id=? AND status IN ('queued','running')", Integer.class, taskId) != 0) continue;
            boolean published = db.queryForObject("SELECT COUNT(*) FROM images WHERE url=? AND bucket_id IS NULL", Integer.class, url) != 0;
            try {
                if (!published) local.remove(url);
                local.unmarkLocal(url);
            } catch (RuntimeException failure) {
                report(OpsIssues.Kind.IMAGE_DELETE_FAILED, new Context(taskId, null, null), null, code(failure));
            }
        }
    }

    private void report(OpsIssues.Kind kind, Context c, String bucket, String code) {
        issues.record(kind, c.taskId(), c.ownerId(), c.channelId(), bucket, code);
    }
    private static String code(RuntimeException e) { return e instanceof ApiException a ? a.code() : "STORAGE"; }
}
