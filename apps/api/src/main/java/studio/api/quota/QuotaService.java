package studio.api.quota;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import studio.api.common.ApiException;
import studio.api.common.DatabaseTransactions;
import studio.api.common.Json;
import studio.api.task.RequestParser;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;

@Service
public class QuotaService {
    private final JdbcTemplate db;
    private final DatabaseTransactions transactions;
    private final Json json;
    public QuotaService(JdbcTemplate db, DatabaseTransactions transactions, Json json) {
        this.db = db; this.transactions = transactions; this.json = json;
    }
    public record Settings(Integer defaultDailyLimit, int globalConcurrency, int perUserConcurrency, int queueLimit) {}
    public Settings settings() {
        return db.queryForObject("SELECT * FROM site_settings WHERE id=1", (rs, i) -> new Settings(rs.getObject("default_daily_limit", Integer.class), rs.getInt("global_concurrency"), rs.getInt("per_user_concurrency"), rs.getInt("queue_limit")));
    }
    public Settings update(JsonNode input) {
        Integer limit = nullableLimit(input.path("defaultDailyLimit"));
        int global = RequestParser.integer(input.path("globalConcurrency"), 2, 1, 32, "全站并发");
        int perUser = RequestParser.integer(input.path("perUserConcurrency"), 1, 1, 32, "单人并发");
        int queue = RequestParser.integer(input.path("queueLimit"), 100, 1, 10000, "排队上限");
        if (perUser > global) throw ApiException.validation("单人并发不能超过全站并发。");
        return transactions.locked(() -> {
            db.update("UPDATE site_settings SET default_daily_limit=?,global_concurrency=?,per_user_concurrency=?,queue_limit=? WHERE id=1", limit, global, perUser, queue);
            return settings();
        });
    }
    /** Called inside the same locked transaction that accepts the durable task. */
    public String reserve(String userId, boolean shared) {
        var users = db.query("SELECT enabled,daily_limit FROM app_users WHERE id=?", (rs, i) -> new UserLimit(rs.getBoolean(1), rs.getObject(2, Integer.class)), userId);
        if (users.isEmpty() || !users.getFirst().enabled) throw new ApiException("AUTH", "账号不可用。", 403, false);
        if (!shared) return null;
        Integer limit = users.getFirst().limit == null ? settings().defaultDailyLimit : users.getFirst().limit;
        if (limit == null) throw new ApiException("VALIDATION", "管理员尚未配置共享渠道额度。", 403, false);
        String day = today();
        int used = used(userId, day);
        if (limit >= 0 && used >= limit) throw new ApiException("RATE_LIMIT", "今日共享渠道额度已用完（含排队预占）。", 429, true);
        int updated = db.update("UPDATE daily_usage SET task_count=task_count+1 WHERE user_id=? AND usage_day=?", userId, day);
        if (updated == 0) db.update("INSERT INTO daily_usage(user_id,usage_day,task_count) VALUES(?,?,1)", userId, day);
        return day;
    }
    /** The task's quota_reserved flag is cleared in this transaction, so a failure can refund once only. */
    public void refund(String userId, String day) {
        if (db.update("UPDATE daily_usage SET task_count=task_count-1 WHERE user_id=? AND usage_day=? AND task_count>0", userId, day) != 1)
            throw new IllegalStateException("Quota ledger does not match the task reservation");
    }
    public ObjectNode current(String userId) {
        return transactions.locked(() -> {
            Integer override = db.queryForObject("SELECT daily_limit FROM app_users WHERE id=?", Integer.class, userId);
            Integer limit = override == null ? settings().defaultDailyLimit : override;
            String day = today();
            int used = used(userId, day);
            ObjectNode result = json.object().put("date", day).put("used", used).put("configured", limit != null).put("unlimited", limit != null && limit == -1);
            if (limit == null) result.putNull("limit"); else result.put("limit", limit);
            if (limit == null || limit < 0) result.putNull("remaining"); else result.put("remaining", Math.max(0, limit - used));
            return result;
        });
    }
    public Object usage() {
        var users = db.queryForList("SELECT t.user_id AS \"userId\",u.username AS \"username\",COUNT(*) AS \"total\",SUM(CASE WHEN t.status='succeeded' THEN 1 ELSE 0 END) AS \"succeeded\",SUM(CASE WHEN t.status='failed' THEN 1 ELSE 0 END) AS \"failed\",SUM(CASE WHEN t.status IN ('queued','running') THEN 1 ELSE 0 END) AS \"active\" FROM task_usage t LEFT JOIN app_users u ON u.id=t.user_id GROUP BY t.user_id,u.username");
        var channels = db.queryForList("SELECT t.channel_id AS \"channelId\",COALESCE(c.name,'已删除渠道') AS \"name\",COUNT(*) AS \"total\",SUM(CASE WHEN t.status='succeeded' THEN 1 ELSE 0 END) AS \"succeeded\",SUM(CASE WHEN t.status='failed' THEN 1 ELSE 0 END) AS \"failed\",SUM(CASE WHEN t.status IN ('queued','running') THEN 1 ELSE 0 END) AS \"active\" FROM task_usage t LEFT JOIN channels c ON c.id=t.channel_id GROUP BY t.channel_id,c.name");
        var tasks = db.queryForList("SELECT t.task_id AS \"id\",t.user_id AS \"userId\",u.username AS \"username\",t.channel_id AS \"channelId\",t.status AS \"status\",t.created_at AS \"createdAt\" FROM task_usage t LEFT JOIN app_users u ON u.id=t.user_id ORDER BY t.created_at DESC,t.task_id DESC LIMIT 100");
        return Map.of("users", users, "channels", channels, "tasks", tasks);
    }
    private int used(String userId, String day) {
        var values = db.query("SELECT task_count FROM daily_usage WHERE user_id=? AND usage_day=?", (rs, i) -> rs.getInt(1), userId, day);
        return values.isEmpty() ? 0 : values.getFirst();
    }
    public static Integer nullableLimit(JsonNode node) {
        if (node.isNull() || node.isMissingNode()) return null;
        return RequestParser.integer(node, 0, -1, 1000000, "每日额度");
    }
    private static String today() { return LocalDate.now(ZoneId.of("Asia/Shanghai")).toString(); }
    private record UserLimit(boolean enabled, Integer limit) {}
}
