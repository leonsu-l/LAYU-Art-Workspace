package studio.api.storage;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import studio.api.common.ApiException;
import studio.api.common.DatabaseTransactions;
import studio.api.common.SecretBox;
import studio.api.task.RequestParser;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class StorageSettings {
    private final JdbcTemplate db;
    private final DatabaseTransactions transactions;
    private final SecretBox secrets;
    // One API writer per deployment. A paid result can still use the last committed retention policy
    // if the database goes offline while the provider is working.
    private volatile Policy lastChange;

    public StorageSettings(JdbcTemplate db, DatabaseTransactions transactions, SecretBox secrets) {
        this.db = db; this.transactions = transactions; this.secrets = secrets;
    }

    public record Policy(String bucketId, Integer retentionDays) {}
    public record BucketInfo(String id, String accountId, String bucketName, String jurisdiction,
                             boolean hasAccessKeyId, boolean hasSecretAccessKey, boolean hasAnalyticsToken) {}
    public record ApplicationUsage(long imageCount, long totalBytes) {}
    private record StoredBucket(String id, String accountId, String bucketName, String jurisdiction,
                                String accessCipher, String secretCipher, String analyticsCipher) {}

    public Policy policy() {
        return db.queryForObject("SELECT active_bucket_id,retention_days FROM site_settings WHERE id=1",
                (rs, row) -> new Policy(rs.getString(1), (Integer) rs.getObject(2)));
    }

    public R2Bucket bucket(String id) {
        StoredBucket b = stored(id);
        return new R2Bucket(b.id(), b.accountId(), b.bucketName(), b.jurisdiction(),
                secrets.decrypt(b.accessCipher()), secrets.decrypt(b.secretCipher()),
                b.analyticsCipher() == null ? null : secrets.decrypt(b.analyticsCipher()));
    }

    public Policy lastKnown(Policy beforeBilling) {
        Policy changed = lastChange;
        return changed == null ? beforeBilling : changed;
    }

    public synchronized Policy updatePolicy(JsonNode input) {
        fields(input, Set.of("activeBucketId", "retentionDays"));
        if (!input.has("activeBucketId") || !input.has("retentionDays"))
            throw ApiException.validation("必须提供 activeBucketId 和 retentionDays。 ");
        JsonNode active = input.get("activeBucketId"), retention = input.get("retentionDays");
        String id = active.isNull() ? null : RequestParser.id(active);
        if (!retention.isNull() && (!retention.isIntegralNumber() || !retention.canConvertToInt()
                || retention.intValue() < 1 || retention.intValue() > 3650))
            throw ApiException.validation("retentionDays 必须为 null 或 1 至 3650 的整数。");
        Integer days = retention.isNull() ? null : retention.intValue();
        lastChange = transactions.locked(() -> {
            if (id != null) stored(id);
            db.update("UPDATE site_settings SET active_bucket_id=?,retention_days=? WHERE id=1", id, days);
            return new Policy(id, days);
        });
        return lastChange;
    }

    public List<BucketInfo> list() {
        return db.query("SELECT id,account_id,bucket_name,jurisdiction,analytics_token_cipher FROM r2_buckets ORDER BY account_id,bucket_name,jurisdiction,id",
                (rs, row) -> new BucketInfo(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), true, true, rs.getString(5) != null));
    }

    public BucketInfo create(JsonNode input) {
        fields(input, Set.of("accountId", "bucketName", "jurisdiction", "accessKeyId", "secretAccessKey", "analyticsToken"));
        String account = text(input.path("accountId"), "账户 ID", 32).toLowerCase(Locale.ROOT);
        if (!account.matches("[0-9a-f]{32}")) throw ApiException.validation("账户 ID 必须为 32 位十六进制字符。");
        String name = text(input.path("bucketName"), "桶名称", 63);
        if (!name.matches("[a-z0-9][a-z0-9-]{1,61}[a-z0-9]")) throw ApiException.validation("桶名称无效。");
        String jurisdiction = input.has("jurisdiction") ? text(input.path("jurisdiction"), "jurisdiction", 16) : "default";
        if (!Set.of("default", "eu", "fedramp").contains(jurisdiction)) throw ApiException.validation("jurisdiction 无效。");
        String access = credential(input.path("accessKeyId"));
        String secret = credential(input.path("secretAccessKey"));
        String token = !input.hasNonNull("analyticsToken") ? null : credential(input.get("analyticsToken"));
        String accessCipher = secrets.encrypt(access), secretCipher = secrets.encrypt(secret);
        String tokenCipher = token == null ? null : secrets.encrypt(token);
        String id = UUID.randomUUID().toString();
        return transactions.locked(() -> {
            Integer count = db.queryForObject("SELECT COUNT(*) FROM r2_buckets WHERE account_id=? AND bucket_name=? AND jurisdiction=?", Integer.class, account, name, jurisdiction);
            if (count != null && count > 0) throw conflict("该 R2 桶已配置。");
            db.update("INSERT INTO r2_buckets(id,account_id,bucket_name,jurisdiction,access_key_id_cipher,secret_access_key_cipher,analytics_token_cipher) VALUES(?,?,?,?,?,?,?)",
                    id, account, name, jurisdiction, accessCipher, secretCipher, tokenCipher);
            return new BucketInfo(id, account, name, jurisdiction, true, true, tokenCipher != null);
        });
    }

    public BucketInfo rotate(String id, JsonNode input) {
        fields(input, Set.of("accessKeyId", "secretAccessKey", "analyticsToken"));
        String access = input.has("accessKeyId") ? secrets.encrypt(credential(input.get("accessKeyId"))) : null;
        String secret = input.has("secretAccessKey") ? secrets.encrypt(credential(input.get("secretAccessKey"))) : null;
        boolean tokenPresent = input.has("analyticsToken");
        String token = tokenPresent && !input.get("analyticsToken").isNull() ? secrets.encrypt(credential(input.get("analyticsToken"))) : null;
        return transactions.locked(() -> {
            StoredBucket old = stored(id);
            String nextToken = tokenPresent ? token : old.analyticsCipher();
            db.update("UPDATE r2_buckets SET access_key_id_cipher=?,secret_access_key_cipher=?,analytics_token_cipher=? WHERE id=?",
                    access == null ? old.accessCipher() : access, secret == null ? old.secretCipher() : secret, nextToken, id);
            return new BucketInfo(old.id(), old.accountId(), old.bucketName(), old.jurisdiction(), true, true, nextToken != null);
        });
    }

    public void delete(String id) {
        transactions.locked(() -> {
            stored(id);
            Integer references = db.queryForObject("SELECT (SELECT COUNT(*) FROM site_settings WHERE active_bucket_id=?) + " +
                    "(SELECT COUNT(*) FROM tasks WHERE write_bucket_id=?) + (SELECT COUNT(*) FROM images WHERE bucket_id=?) + " +
                    "(SELECT COUNT(*) FROM file_deletions WHERE bucket_id=?)", Integer.class, id, id, id, id);
            if (references != null && references > 0) throw conflict("桶仍被存储设置、任务或文件引用，无法删除。");
            db.update("DELETE FROM r2_buckets WHERE id=?", id);
            return null;
        });
    }

    public ApplicationUsage applicationUsage(String id) {
        stored(id);
        return db.queryForObject("SELECT COUNT(*),COALESCE(SUM(i.bytes),0) FROM images i JOIN tasks t ON t.id=i.task_id " +
                "WHERE i.bucket_id=? AND (t.expires_at IS NULL OR t.expires_at>?)",
                (rs, row) -> new ApplicationUsage(rs.getLong(1), rs.getLong(2)), id, System.currentTimeMillis());
    }

    private StoredBucket stored(String id) {
        List<StoredBucket> result = db.query("SELECT id,account_id,bucket_name,jurisdiction,access_key_id_cipher,secret_access_key_cipher,analytics_token_cipher FROM r2_buckets WHERE id=?", this::row, id);
        if (result.isEmpty()) throw ApiException.notFound();
        return result.getFirst();
    }
    private StoredBucket row(ResultSet rs, int row) throws SQLException {
        return new StoredBucket(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7));
    }
    private static void fields(JsonNode input, Set<String> allowed) {
        RequestParser.object(input);
        input.fieldNames().forEachRemaining(field -> { if (!allowed.contains(field)) throw ApiException.validation("请求包含不支持的字段。"); });
    }
    private static String text(JsonNode node, String label, int max) {
        if (node == null || !node.isTextual() || node.textValue().isBlank() || node.textValue().length() > max)
            throw ApiException.validation(label + "不能为空或超过长度限制。");
        String value = node.textValue();
        if (!value.equals(value.trim())) throw ApiException.validation(label + "格式无效。");
        return value;
    }
    private static String credential(JsonNode node) {
        String value = text(node, "凭据", 4096);
        if (value.chars().anyMatch(c -> c < 33 || c > 126)) throw ApiException.validation("凭据格式无效。");
        return value;
    }
    private static ApiException conflict(String message) { return new ApiException("VALIDATION", message, 409, false); }
}
