package studio.api.channel;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import studio.api.auth.AuthService;
import studio.api.common.ApiException;
import studio.api.common.DatabaseTransactions;
import studio.api.common.Json;
import studio.api.task.RequestParser;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class ChannelController {
    private final AuthService auth;
    private final ChannelService channels;
    private final JdbcTemplate db;
    private final Json json;
    private final RequestParser parser;
    private final DatabaseTransactions transactions;
    public ChannelController(AuthService auth, ChannelService channels, JdbcTemplate db, Json json, RequestParser parser, DatabaseTransactions transactions) {
        this.auth = auth; this.channels = channels; this.db = db; this.json = json; this.parser = parser; this.transactions = transactions;
    }
    @GetMapping("/channels") public Object channels() { return Map.of("channels", channels.list(auth.requireUser())); }
    @PostMapping("/channels") public Object create(@RequestBody JsonNode input) { return Map.of("channel", channels.create(auth.requireUser(), input)); }
    @PutMapping("/channels/{id}") public Object update(@PathVariable String id, @RequestBody JsonNode input) { return Map.of("channel", channels.update(auth.requireUser(), id, input)); }
    @DeleteMapping("/channels/{id}") public Object delete(@PathVariable String id) { channels.delete(auth.requireUser(), id); return Map.of("ok", true); }
    @GetMapping("/channels/{id}/models") public Object models(@PathVariable String id) { return channels.models(auth.requireUser(), id); }
    @PostMapping("/channels/{id}/models/refresh") public Object refresh(@PathVariable String id) { return channels.refresh(auth.requireUser(), id); }
    @GetMapping("/preferences") public Object preference(@RequestParam String channelId, @RequestParam String model) { return channels.preference(auth.requireUser(), channelId, model); }
    @PutMapping("/preferences") public Object preference(@RequestBody JsonNode input) { channels.savePreference(auth.requireUser(), input); return Map.of("ok", true); }
    @GetMapping("/templates") public Object templates() {
        auth.requireUser();
        return Map.of("templates", db.query("SELECT * FROM parameter_templates ORDER BY name,id", (rs, i) -> template(rs.getString("id"), rs.getString("name"), rs.getString("provider"), rs.getString("params_json"))));
    }
    @PostMapping("/admin/templates") public Object createTemplate(@RequestBody JsonNode input) {
        auth.requireAdmin();
        return Map.of("template", saveTemplate(UUID.randomUUID().toString(), input, false));
    }
    @PutMapping("/admin/templates/{id}") public Object updateTemplate(@PathVariable String id, @RequestBody JsonNode input) {
        auth.requireAdmin();
        return Map.of("template", saveTemplate(id, input, true));
    }
    @DeleteMapping("/admin/templates/{id}") public Object deleteTemplate(@PathVariable String id) {
        auth.requireAdmin();
        db.update("DELETE FROM parameter_templates WHERE id=?", id);
        return Map.of("ok", true);
    }
    private ObjectNode saveTemplate(String id, JsonNode input, boolean update) {
        String name = RequestParser.text(input.path("name"), "模板名称", 120);
        String provider = RequestParser.provider(input.path("provider"));
        String params = json.write(parser.parameters(provider, input.path("params")));
        return transactions.locked(() -> {
            if (update) {
                if (db.update("UPDATE parameter_templates SET name=?,provider=?,params_json=? WHERE id=?", name, provider, params, id) == 0) throw ApiException.notFound();
            } else db.update("INSERT INTO parameter_templates(id,name,provider,params_json) VALUES(?,?,?,?)", id, name, provider, params);
            return template(id, name, provider, params);
        });
    }
    private ObjectNode template(String id, String name, String provider, String params) {
        ObjectNode node = json.object().put("id", id).put("name", name).put("provider", provider);
        node.set("params", json.object(params));
        return node;
    }
}
