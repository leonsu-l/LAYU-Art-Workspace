package studio.api.ops;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.common.ApiException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * Best-effort operational reporting. Call with canonical internal IDs and known error codes,
 * never messages, URLs or exception text. Each write uses an independent transaction and a
 * dedicated issue lock, never runtime_lock, so it may be called while runtime_lock is held.
 * The caller must not hold an issue row or the issue lock in an outer transaction, and the
 * connection pool must allow an additional connection. Reporting must not control task flow.
 */
@Service
public class OpsIssues {
    public enum Kind {
        GENERATION_FAILED("生成任务未完成，可能已经产生上游费用。", "检查渠道及任务状态，确认费用后再手动重试。"),
        R2_FALLBACK("对象存储不可用，已尝试使用备用存储。", "检查对象存储配置和可用性，确认备用存储容量。"),
        IMAGE_WRITE_FAILED("生成图片未能完整保存。", "检查存储空间、权限和连接，确认费用后再手动重试。"),
        IMAGE_READ_FAILED("已保存图片暂时无法读取。", "检查存储连接、权限和文件完整性。"),
        IMAGE_DELETE_FAILED("图片清理未完成，可能残留存储数据。", "检查存储权限和连接，保留并重试清理任务。");

        final String impact;
        final String advice;
        Kind(String impact, String advice) { this.impact = impact; this.advice = advice; }
    }

    public record Issue(String id, Kind kind, String taskId, String ownerId, String channelId,
                        String bucketId, String errorCode, String status, long occurrences,
                        long firstSeen, long lastSeen, String impact, String advice) { }
    public record Page(List<Issue> issues, int page, int size, long total) { }

    private static final long RETENTION_MS = Duration.ofDays(30).toMillis();
    private static final Pattern ID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final Set<String> ERROR_CODES = Set.of("AUTH", "VALIDATION", "CONFLICT", "RATE_LIMIT", "NETWORK", "BAD_RESPONSE", "STORAGE", "UNSUPPORTED", "UNKNOWN");
    private final JdbcTemplate db;
    private final TransactionTemplate independent;

    public OpsIssues(JdbcTemplate db, PlatformTransactionManager manager) {
        this.db = db;
        this.independent = new TransactionTemplate(manager);
        this.independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** Invalid identifiers are omitted and unrecognized error codes become UNKNOWN. */
    public void record(Kind kind, String taskId, String ownerId, String channelId, String bucketId, String errorCode) {
        if (kind == null) return;
        String task = safeId(taskId), owner = safeId(ownerId), channel = safeId(channelId), bucket = safeId(bucketId);
        String code = ERROR_CODES.contains(errorCode == null ? "" : errorCode) ? errorCode : "UNKNOWN";
        try {
            String key = fingerprint(kind, task, owner, channel, bucket, code);
            locked(() -> {
                long now = System.currentTimeMillis();
                db.update("DELETE FROM admin_issues WHERE fingerprint=? AND last_seen<?", key, now - RETENTION_MS);
                int updated = db.update("UPDATE admin_issues SET occurrences=occurrences+1,last_seen=?,status='open' WHERE fingerprint=?", now, key);
                if (updated == 0) {
                    db.update("INSERT INTO admin_issues(id,fingerprint,kind,task_id,owner_id,channel_id,bucket_id,error_code,status,occurrences,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?, 'open',1,?,?)",
                            UUID.randomUUID().toString(), key, kind.name(), task, owner, channel, bucket, code, now, now);
                }
                return null;
            });
        } catch (RuntimeException ignored) {
            // Deliberately do not log exception messages: they can contain SQL or sensitive data.
        }
    }

    public Page list(int page, int size, String status) {
        if (page < 0 || page > 10000 || size < 1 || size > 100) throw ApiException.validation("分页参数无效。");
        if (status != null && !status.equals("open") && !status.equals("resolved")) throw ApiException.validation("问题状态无效。");
        long cutoff = System.currentTimeMillis() - RETENTION_MS;
        String where = status == null ? "last_seen>=?" : "last_seen>=? AND status=?";
        Object[] args = status == null ? new Object[]{cutoff} : new Object[]{cutoff, status};
        Long total = db.queryForObject("SELECT COUNT(*) FROM admin_issues WHERE " + where, Long.class, args);
        Object[] pageArgs = status == null ? new Object[]{cutoff, size, (long) page * size} : new Object[]{cutoff, status, size, (long) page * size};
        List<Issue> issues = db.query("SELECT * FROM admin_issues WHERE " + where + " ORDER BY last_seen DESC,id DESC LIMIT ? OFFSET ?", (rs, row) -> {
            Kind kind = Kind.valueOf(rs.getString("kind"));
            return new Issue(rs.getString("id"), kind, rs.getString("task_id"), rs.getString("owner_id"),
                    rs.getString("channel_id"), rs.getString("bucket_id"), rs.getString("error_code"),
                    rs.getString("status"), rs.getLong("occurrences"), rs.getLong("first_seen"), rs.getLong("last_seen"), kind.impact, kind.advice);
        }, pageArgs);
        return new Page(issues, page, size, total == null ? 0 : total);
    }

    public long openCount() {
        Long count = db.queryForObject("SELECT COUNT(*) FROM admin_issues WHERE status='open' AND last_seen>=?", Long.class, System.currentTimeMillis() - RETENTION_MS);
        return count == null ? 0 : count;
    }

    public void resolve(String id) {
        locked(() -> {
            if (db.update("UPDATE admin_issues SET status='resolved' WHERE id=? AND last_seen>=?", id, System.currentTimeMillis() - RETENTION_MS) == 0)
                throw ApiException.notFound();
            return null;
        });
    }

    @Scheduled(fixedDelay = 3600000)
    public void purgeExpired() {
        locked(() -> { db.update("DELETE FROM admin_issues WHERE last_seen<?", System.currentTimeMillis() - RETENTION_MS); return null; });
    }

    private <T> T locked(Supplier<T> action) {
        return independent.execute(status -> {
            db.queryForObject("SELECT id FROM admin_issues_lock WHERE id=1 FOR UPDATE", Integer.class);
            return action.get();
        });
    }

    private static String safeId(String value) {
        return value != null && ID.matcher(value).matches() ? value.toLowerCase(Locale.ROOT) : null;
    }

    private static String fingerprint(Kind kind, String task, String owner, String channel, String bucket, String code) {
        // Fixed-width UUIDs and explicit separators make null and context boundaries unambiguous.
        String identity = kind.name() + '|' + (task == null ? "context|" + owner + '|' + channel : "task|" + task) + '|' + bucket + '|' + code;
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(identity.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
