package studio.api.task;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import studio.api.common.ApiException;
import studio.api.common.Json;
import java.net.URI;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

@Component
public class RequestParser {
    public static final Pattern UUID_PATTERN = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}");
    private final Json json;
    public RequestParser(Json json) { this.json = json; }
    public record Submission(String id, GenerationRequest request) {}

    public Submission direct(JsonNode input) {
        object(input);
        String id = id(input.path("id"));
        JsonNode config = object(input.path("config"));
        String provider = provider(config.path("activeProvider"));
        JsonNode profile = object(object(config.path("profiles")).path(provider));
        return new Submission(id, request(provider, text(profile.path("model"), "模型", 512),
                baseUrl(profile.path("baseUrl")), text(profile.path("apiKey"), "API Key", 4096),
                profile.path("params"), input.path("prompt"), input.path("referenceImages")));
    }

    public GenerationRequest request(String provider, String model, String baseUrl, String apiKey,
                                     JsonNode parameters, JsonNode prompt, JsonNode references) {
        return new GenerationRequest(provider, model, baseUrl, apiKey, parameters(provider, parameters),
                text(prompt, "提示词", 4000), references(provider, model, references));
    }

    public ObjectNode parameters(String provider, JsonNode source) {
        object(source);
        ObjectNode result = json.object();
        if (provider.equals("openai-compatible")) {
            String size = optionalText(source, "size", "1024x1024", 32);
            if (!size.equals("auto") && !size.matches("[1-9][0-9]{0,4}x[1-9][0-9]{0,4}")) throw ApiException.validation("尺寸必须为 auto 或 WIDTHxHEIGHT。");
            result.put("size", size);
            result.put("quality", optionalText(source, "quality", "auto", 64));
            result.put("n", integer(source.path("n"), 1, 1, 10, "图片数量"));
            result.put("background", optionalText(source, "background", "auto", 64));
            String format = optionalText(source, "outputFormat", "png", 16);
            if (!Set.of("png", "jpeg", "webp").contains(format)) throw ApiException.validation("输出格式必须为 png、jpeg 或 webp。");
            result.put("outputFormat", format);
            result.put("outputCompression", integer(source.path("outputCompression"), 100, 0, 100, "压缩质量"));
            result.put("moderation", optionalText(source, "moderation", "auto", 64));
        } else {
            result.put("imageSize", optionalText(source, "imageSize", "auto", 32));
            String ratio = optionalText(source, "aspectRatio", "auto", 32);
            if (!ratio.equals("auto") && !ratio.matches("[1-9][0-9]{0,3}:[1-9][0-9]{0,3}")) throw ApiException.validation("比例必须为 auto 或 W:H。");
            result.put("aspectRatio", ratio);
            result.put("thinkingLevel", optionalText(source, "thinkingLevel", "auto", 32));
            if (source.has("imageOnly") && !source.get("imageOnly").isBoolean()) throw ApiException.validation("imageOnly 必须为布尔值。");
            result.put("imageOnly", source.path("imageOnly").asBoolean(false));
        }
        return result;
    }

    private List<GenerationRequest.ReferenceImage> references(String provider, String model, JsonNode input) {
        if (input.isMissingNode() || input.isNull()) return List.of();
        boolean openai = provider.equals("openai-compatible");
        int count = openai ? 16 : 14;
        int maxSingle = (openai ? 20 : 12) * 1024 * 1024;
        int maxTotal = (openai ? 32 : 12) * 1024 * 1024;
        if (!input.isArray() || input.size() > count) throw ApiException.validation("参考图数量无效，当前最多 " + count + " 张。");
        var result = new ArrayList<GenerationRequest.ReferenceImage>();
        long total = 0;
        for (JsonNode item : input) {
            object(item);
            String name = text(item.path("name"), "参考图名称", 255);
            String mime = text(item.path("mimeType"), "参考图格式", 40);
            String data = text(item.path("base64Data"), "参考图内容", (maxSingle + 2) / 3 * 4);
            if (data.length() % 4 != 0 || !data.matches("[A-Za-z0-9+/]+={0,2}")) throw ApiException.validation("参考图 Base64 无效。");
            byte[] bytes;
            try { bytes = Base64.getDecoder().decode(data); }
            catch (IllegalArgumentException e) { throw ApiException.validation("参考图 Base64 无效。"); }
            if (!Base64.getEncoder().encodeToString(bytes).equals(data)) throw ApiException.validation("参考图 Base64 编码不规范。");
            total += bytes.length;
            if (bytes.length == 0 || bytes.length > maxSingle || total > maxTotal) throw ApiException.validation("参考图超过体积上限。");
            if (!mime.equals(detectMime(bytes))) throw ApiException.validation("参考图内容与 PNG/JPEG/WebP 格式不符。");
            result.add(new GenerationRequest.ReferenceImage(name, mime, data));
        }
        return List.copyOf(result);
    }

    private String detectMime(byte[] bytes) {
        if (bytes.length >= 8 && bytes[0] == (byte)137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71 && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10) return "image/png";
        if (bytes.length >= 3 && bytes[0] == (byte)255 && bytes[1] == (byte)216 && bytes[2] == (byte)255) return "image/jpeg";
        if (bytes.length >= 12 && new String(bytes, 0, 4, java.nio.charset.StandardCharsets.US_ASCII).equals("RIFF") && new String(bytes, 8, 4, java.nio.charset.StandardCharsets.US_ASCII).equals("WEBP")) return "image/webp";
        return "";
    }
    public static String id(JsonNode node) {
        String id = text(node, "ID", 36);
        if (!UUID_PATTERN.matcher(id).matches()) throw ApiException.validation("ID 必须为有效 UUID。");
        return id.toLowerCase(Locale.ROOT);
    }
    public static JsonNode object(JsonNode node) {
        if (node == null || !node.isObject()) throw ApiException.validation("请求对象格式无效。");
        return node;
    }
    public static String text(JsonNode node, String label, int max) {
        if (node == null || !node.isTextual() || node.asText().length() > max || node.asText().isBlank()) throw ApiException.validation(label + "不能为空或超过长度限制。");
        return node.asText().trim();
    }
    public static String optionalText(JsonNode node, String field, String fallback, int max) {
        return node.has(field) ? text(node.get(field), field, max) : fallback;
    }
    public static int integer(JsonNode node, int fallback, int min, int max, String label) {
        if (node.isMissingNode()) return fallback;
        if (!node.isIntegralNumber() || !node.canConvertToInt() || node.intValue() < min || node.intValue() > max) throw ApiException.validation(label + "必须为 " + min + " 到 " + max + " 的整数。");
        return node.intValue();
    }
    public static String provider(JsonNode node) {
        String value = text(node, "协议", 32);
        if (!Set.of("openai-compatible", "gemini-compatible").contains(value)) throw ApiException.validation("不支持的协议。");
        return value;
    }
    public static String baseUrl(JsonNode node) {
        String value = text(node, "Base URL", 2048);
        try {
            URI uri = URI.create(value);
            if (uri.getScheme() == null || !Set.of("http", "https").contains(uri.getScheme().toLowerCase(Locale.ROOT)) || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) throw new IllegalArgumentException();
        } catch (IllegalArgumentException e) { throw ApiException.validation("Base URL 必须为 HTTP(S) 地址，不能包含用户名、密码或片段。"); }
        return value;
    }
}
