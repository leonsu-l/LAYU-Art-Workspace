package studio.api.channel;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;
import studio.api.common.ApiException;
import studio.api.common.HttpBytes;
import studio.api.common.Json;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;

@Component
public class ModelCatalog {
    private final Json json;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
    public ModelCatalog(Json json) { this.json = json; }
    public record Model(String id, String name) {}

    public List<Model> discover(String provider, String baseUrl, String key) {
        boolean gemini = provider.equals("gemini-compatible");
        String endpoint = studio.api.provider.ProviderUrls.models(provider, baseUrl).toASCIIString();
        var found = new LinkedHashMap<String, Model>();
        Set<String> tokens = new HashSet<>();
        String page = null;
        for (int i = 0; i < 10; i++) {
            String url = endpoint;
            if (gemini) {
                url += (url.contains("?") ? "&" : "?") + "pageSize=1000";
                if (page != null) url += "&pageToken=" + URLEncoder.encode(page, StandardCharsets.UTF_8);
            }
            var request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15)).GET()
                    .header(gemini ? "x-goog-api-key" : "Authorization", gemini ? key : "Bearer " + key).build();
            var response = HttpBytes.send(client, request, 4 * 1024 * 1024, Duration.ofSeconds(15));
            if (response.statusCode() < 200 || response.statusCode() >= 300)
                throw new ApiException("BAD_RESPONSE", "模型目录请求失败（HTTP " + response.statusCode() + "）；可检查凭据或手动填写模型 ID。", 502, true);
            JsonNode payload;
            try { payload = json.mapper().readTree(response.body()); }
            catch (Exception e) { throw new ApiException("BAD_RESPONSE", "渠道没有返回有效的模型目录。", 502, false); }
            JsonNode items = payload == null ? null : payload.get(gemini ? "models" : "data");
            if (items == null || !items.isArray()) throw new ApiException("BAD_RESPONSE", "渠道不提供标准模型目录，可手动填写模型 ID。", 502, false);
            for (JsonNode item : items) {
                String id = item.path(gemini ? "name" : "id").asText("");
                if (gemini && id.startsWith("models/")) id = id.substring(7);
                if (id.isBlank() || id.length() > 512) continue;
                String name = item.path("displayName").asText(id);
                if (name.length() > 512) name = id;
                found.put(id, new Model(id, name));
                if (found.size() > 10000) throw new ApiException("BAD_RESPONSE", "模型目录超过应用上限。", 502, false);
            }
            page = gemini ? payload.path("nextPageToken").asText("") : "";
            if (page.isEmpty()) return new ArrayList<>(found.values());
            if (!tokens.add(page) || i == 9) throw new ApiException("BAD_RESPONSE", "模型目录分页未能完整读取，保留旧目录。", 502, true);
        }
        throw new IllegalStateException("Unreachable model pagination state");
    }
}
