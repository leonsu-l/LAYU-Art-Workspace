package studio.api.channel;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import studio.api.auth.UserPrincipal;
import studio.api.common.ApiException;
import studio.api.common.DatabaseTransactions;
import studio.api.common.Json;
import studio.api.common.SecretBox;
import studio.api.task.GenerationRequest;
import studio.api.task.RequestParser;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class ChannelService {
    private final JdbcTemplate db;
    private final DatabaseTransactions transactions;
    private final Json json;
    private final SecretBox secrets;
    private final ModelCatalog catalog;
    private final RequestParser parser;
    private final ApplicationEventPublisher events;
    private final Set<String> refreshing = ConcurrentHashMap.newKeySet();
    public ChannelService(JdbcTemplate db, DatabaseTransactions transactions, Json json, SecretBox secrets,
                          ModelCatalog catalog, RequestParser parser, ApplicationEventPublisher events) {
        this.db = db; this.transactions = transactions; this.json = json; this.secrets = secrets;
        this.catalog = catalog; this.parser = parser; this.events = events;
    }
    public record Channel(String id, String ownerId, String name, String provider, String baseUrl,
                          String secret, boolean enabled, String enabledModels, String catalog,
                          Long updatedAt, String error, int revision) {}

    public List<ObjectNode> list(UserPrincipal user) {
        String sql = isAdmin(user) ? "SELECT * FROM channels WHERE owner_id IS NULL OR owner_id=? ORDER BY created_at,id"
                : "SELECT * FROM channels WHERE (owner_id IS NULL AND enabled=TRUE) OR owner_id=? ORDER BY created_at,id";
        return db.query(sql, this::row, user.id()).stream().map(c -> publicChannel(user, c)).toList();
    }
    public ObjectNode create(UserPrincipal user, JsonNode input) {
        RequestParser.object(input);
        String scope = RequestParser.text(input.path("scope"), "渠道类型", 16);
        if (!Set.of("shared", "private").contains(scope)) throw ApiException.validation("渠道类型无效。");
        if (scope.equals("shared") && !isAdmin(user)) throw forbidden();
        String id = UUID.randomUUID().toString();
        String name = RequestParser.text(input.path("name"), "渠道名称", 120);
        String provider = RequestParser.provider(input.path("provider"));
        String base = RequestParser.baseUrl(input.path("baseUrl"));
        String key = RequestParser.text(input.path("apiKey"), "API Key", 4096);
        String models = json.write(modelIds(input.path("enabledModels")));
        return transactions.locked(() -> {
            String now = Instant.now().toString();
            db.update("INSERT INTO channels(id,owner_id,name,provider,base_url,secret_cipher,enabled,enabled_models_json,catalog_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    id, scope.equals("private") ? user.id() : null, name, provider, base, secrets.encrypt(key), enabled(input), models, "[]", now, now);
            return publicChannel(user, visible(user, id));
        });
    }
    public ObjectNode update(UserPrincipal user, String id, JsonNode input) {
        RequestParser.object(input);
        return transactions.locked(() -> {
            Channel old = manageable(user, id);
            String name = RequestParser.text(input.path("name"), "渠道名称", 120);
            String provider = RequestParser.provider(input.path("provider"));
            String base = RequestParser.baseUrl(input.path("baseUrl"));
            String key = input.has("apiKey") && !input.path("apiKey").asText().isBlank()
                    ? RequestParser.text(input.path("apiKey"), "API Key", 4096) : null;
            boolean enabled = enabled(input);
            String models = json.write(modelIds(input.path("enabledModels")));
            boolean connectionChanged = !old.provider.equals(provider) || !old.baseUrl.equals(base) || key != null;
            db.update("UPDATE channels SET name=?,provider=?,base_url=?,secret_cipher=?,enabled=?,enabled_models_json=?,catalog_json=?,catalog_updated_at=?,catalog_error=?,revision=revision+1,updated_at=? WHERE id=?",
                    name, provider, base, key == null ? old.secret : secrets.encrypt(key), enabled, models,
                    connectionChanged ? "[]" : old.catalog, connectionChanged ? null : old.updatedAt,
                    connectionChanged ? null : old.error, Instant.now().toString(), id);
            if (!enabled) events.publishEvent(new ChannelDisabledEvent(id));
            return publicChannel(user, manageable(user, id));
        });
    }
    public void delete(UserPrincipal user, String id) {
        transactions.locked(() -> {
            manageable(user, id);
            events.publishEvent(new ChannelDisabledEvent(id));
            db.update("DELETE FROM generation_preferences WHERE channel_id=?", id);
            db.update("DELETE FROM channels WHERE id=?", id);
            return null;
        });
    }

    public Channel visible(UserPrincipal user, String id) {
        var matches = db.query("SELECT * FROM channels WHERE id=?", this::row, id);
        if (matches.isEmpty()) throw ApiException.notFound();
        Channel channel = matches.getFirst();
        if (channel.ownerId != null && !channel.ownerId.equals(user.id())) throw ApiException.notFound();
        if (channel.ownerId == null && !channel.enabled && !isAdmin(user)) throw ApiException.notFound();
        return channel;
    }
    private Channel manageable(UserPrincipal user, String id) {
        Channel channel = visible(user, id);
        if (!canManage(user, channel)) throw forbidden();
        return channel;
    }
    public GenerationRequest snapshot(UserPrincipal user, String channelId, String model, JsonNode params, JsonNode prompt, JsonNode references) {
        Channel channel = visible(user, channelId);
        if (!channel.enabled) throw new ApiException("VALIDATION", "渠道已停用，请重新选择。", 409, false);
        if (channel.ownerId == null && !json.read(channel.enabledModels, List.class).contains(model))
            throw new ApiException("VALIDATION", "该共享模型尚未由管理员启用。", 400, false);
        return parser.request(channel.provider, model, channel.baseUrl, secrets.decrypt(channel.secret), params, prompt, references);
    }
    public ObjectNode models(UserPrincipal user, String id) {
        Channel channel = visible(user, id);
        boolean manage = canManage(user, channel);
        var byId = new LinkedHashMap<String, JsonNode>();
        JsonNode cached = json.read(channel.catalog, JsonNode.class);
        cached.forEach(model -> byId.put(model.path("id").asText(), model));
        List<String> enabled = modelIds(json.read(channel.enabledModels, JsonNode.class));
        for (String model : enabled) byId.putIfAbsent(model, json.object().put("id", model).put("name", model));
        ObjectNode result = json.object();
        var entries = result.putArray("models");
        byId.forEach((model, entry) -> { if (manage || channel.ownerId != null || enabled.contains(model)) entries.add(entry); });
        result.set("enabledModels", json.mapper().valueToTree(enabled));
        if (channel.updatedAt == null) result.putNull("updatedAt"); else result.put("updatedAt", Instant.ofEpochMilli(channel.updatedAt).toString());
        if (channel.error == null) result.putNull("error"); else result.put("error", channel.error);
        return result.put("canManage", manage).put("stale", channel.updatedAt == null || channel.updatedAt < System.currentTimeMillis() - 3600000 || channel.error != null);
    }
    public ObjectNode refresh(UserPrincipal user, String id) {
        refreshChannel(manageable(user, id));
        return models(user, id);
    }
    private void refreshChannel(Channel channel) {
        if (!refreshing.add(channel.id)) return;
        try {
            List<ModelCatalog.Model> discovered = catalog.discover(channel.provider, channel.baseUrl, secrets.decrypt(channel.secret));
            db.update("UPDATE channels SET catalog_json=?,catalog_updated_at=?,catalog_error=NULL WHERE id=? AND revision=?",
                    json.write(discovered), System.currentTimeMillis(), channel.id, channel.revision);
        } catch (Exception e) {
            String message = e instanceof ApiException api ? api.getMessage() : "模型目录刷新失败，请检查渠道配置；旧目录仍可使用。";
            db.update("UPDATE channels SET catalog_error=? WHERE id=? AND revision=?", message, channel.id, channel.revision);
        } finally { refreshing.remove(channel.id); }
    }
    @Scheduled(fixedDelayString = "${studio.models-refresh-ms:3600000}", initialDelayString = "${studio.models-initial-delay-ms:30000}")
    public void refreshStale() {
        var candidates = db.query("SELECT c.* FROM channels c WHERE c.enabled=TRUE AND (c.owner_id IS NULL OR EXISTS(SELECT 1 FROM app_users u WHERE u.id=c.owner_id AND u.enabled=TRUE)) AND (c.catalog_updated_at IS NULL OR c.catalog_updated_at<?)", this::row, System.currentTimeMillis() - 3600000);
        for (Channel channel : candidates) refreshChannel(channel);
    }
    public ObjectNode preference(UserPrincipal user, String channelId, String model) {
        visible(user, channelId);
        var values = db.query("SELECT params_json FROM generation_preferences WHERE user_id=? AND channel_id=? AND model=?", (rs, i) -> json.object(rs.getString(1)), user.id(), channelId, model);
        ObjectNode result = json.object();
        if (values.isEmpty()) result.putNull("params"); else result.set("params", values.getFirst());
        return result;
    }
    public void savePreference(UserPrincipal user, JsonNode input) {
        String id = RequestParser.id(input.path("channelId"));
        String model = RequestParser.text(input.path("model"), "模型", 512);
        transactions.locked(() -> {
            Channel channel = visible(user, id);
            String params = json.write(parser.parameters(channel.provider, input.path("params")));
            int updated = db.update("UPDATE generation_preferences SET params_json=? WHERE user_id=? AND channel_id=? AND model=?", params, user.id(), id, model);
            if (updated == 0) db.update("INSERT INTO generation_preferences(user_id,channel_id,model,params_json) VALUES(?,?,?,?)", user.id(), id, model, params);
            return null;
        });
    }
    private ObjectNode publicChannel(UserPrincipal user, Channel channel) {
        ObjectNode result = json.object().put("id", channel.id).put("name", channel.name).put("provider", channel.provider)
                .put("scope", channel.ownerId == null ? "shared" : "private").put("baseUrl", canManage(user, channel) ? channel.baseUrl : "")
                .put("enabled", channel.enabled).put("hasApiKey", true).put("canManage", canManage(user, channel));
        result.set("enabledModels", json.read(channel.enabledModels, JsonNode.class));
        return result;
    }
    private Channel row(ResultSet rs, int index) throws SQLException {
        return new Channel(rs.getString("id"), rs.getString("owner_id"), rs.getString("name"), rs.getString("provider"),
                rs.getString("base_url"), rs.getString("secret_cipher"), rs.getBoolean("enabled"), rs.getString("enabled_models_json"),
                rs.getString("catalog_json"), rs.getObject("catalog_updated_at", Long.class), rs.getString("catalog_error"), rs.getInt("revision"));
    }
    private static boolean isAdmin(UserPrincipal user) { return user.role().equals("ADMIN"); }
    private static boolean canManage(UserPrincipal user, Channel channel) { return channel.ownerId == null ? isAdmin(user) : channel.ownerId.equals(user.id()); }
    private static boolean enabled(JsonNode input) {
        if (input.has("enabled") && !input.path("enabled").isBoolean()) throw ApiException.validation("enabled 必须为布尔值。");
        return input.path("enabled").asBoolean(true);
    }
    private static List<String> modelIds(JsonNode input) {
        if (input.isMissingNode()) return List.of();
        if (!input.isArray() || input.size() > 10000) throw ApiException.validation("启用模型列表无效。");
        var ids = new LinkedHashSet<String>();
        input.forEach(value -> ids.add(RequestParser.text(value, "模型 ID", 512)));
        return new ArrayList<>(ids);
    }
    private static ApiException forbidden() { return new ApiException("AUTH", "无权管理此渠道。", 403, false); }
}
