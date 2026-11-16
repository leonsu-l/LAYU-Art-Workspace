package studio.api.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.TreeMap;

@Component
public class Json {
    private final ObjectMapper mapper;
    public Json(ObjectMapper mapper) { this.mapper = mapper; }
    public ObjectMapper mapper() { return mapper; }
    public ObjectNode object() { return mapper.createObjectNode(); }
    public String write(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (Exception e) { throw new IllegalStateException("Cannot serialize application data", e); }
    }
    public <T> T read(String value, Class<T> type) {
        try { return mapper.readValue(value, type); }
        catch (Exception e) { throw new IllegalStateException("Invalid persisted application data", e); }
    }
    public ObjectNode object(String value) { return read(value, ObjectNode.class); }
    public String hash(Object value) {
        try {
            byte[] bytes = mapper.writeValueAsBytes(canonical(mapper.valueToTree(value)));
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (Exception e) { throw new IllegalStateException("Cannot fingerprint request", e); }
    }
    private JsonNode canonical(JsonNode node) {
        if (node.isObject()) {
            var fields = new TreeMap<String, JsonNode>();
            node.fields().forEachRemaining(e -> fields.put(e.getKey(), canonical(e.getValue())));
            var result = mapper.createObjectNode();
            fields.forEach(result::set);
            return result;
        }
        if (node.isArray()) {
            var result = mapper.createArrayNode();
            node.forEach(item -> result.add(canonical(item)));
            return result;
        }
        return node;
    }
}
