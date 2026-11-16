package studio.api.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.core.StreamReadConstraints;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import studio.api.common.ApiException;
import studio.api.common.HttpBytes;
import studio.api.task.GenerationRequest;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Service
public class ProviderService implements ImageProvider {
    // Ten maximum-size 25 MiB images plus JSON/base64 overhead fit within this limit.
    // Parsing a near-limit response can transiently consume several times this amount in heap.
    private static final int RESPONSE_LIMIT = 360 * 1024 * 1024;
    private static final int MAX_JSON_STRING_LENGTH = 36 * 1024 * 1024;
    private final ObjectMapper mapper;
    private final ObjectMapper responseMapper;
    private final Duration timeout;
    private final HttpClient client;

    @Autowired
    public ProviderService(ObjectMapper mapper, @Value("${studio.provider-timeout-seconds:600}") long timeoutSeconds) {
        this(mapper, Duration.ofSeconds(Math.max(1, Math.min(600, timeoutSeconds))));
    }

    /** Convenient bounded-time constructor for protocol tests. */
    public ProviderService(ObjectMapper mapper) { this(mapper, Duration.ofSeconds(600)); }

    public ProviderService(ObjectMapper mapper, Duration timeout) {
        this.mapper = mapper;
        this.timeout = timeout;
        this.responseMapper = mapper.copy();
        this.responseMapper.getFactory().setStreamReadConstraints(StreamReadConstraints.builder()
                .maxStringLength(MAX_JSON_STRING_LENGTH).build());
        this.client = HttpClient.newBuilder().connectTimeout(timeout)
                .followRedirects(HttpClient.Redirect.NEVER).build();
    }

    @Override public ProviderResult generate(GenerationRequest request) {
        if (request == null || request.provider() == null) throw ApiException.validation("供应商配置无效。");
        return switch (request.provider()) {
            case "openai-compatible" -> openAi(request);
            case "gemini-compatible" -> gemini(request);
            default -> throw new ApiException("UNSUPPORTED", "不支持的供应商。", 400, false);
        };
    }

    private ProviderResult openAi(GenerationRequest r) {
        boolean editing = r.referenceImages() != null && !r.referenceImages().isEmpty();
        String endpoint = ProviderUrls.openAi(r.baseUrl(), editing).toASCIIString();
        ObjectNode body = mapper.createObjectNode();
        body.put("model", trim(r.model()));
        body.put("prompt", trim(r.prompt()));
        String size = str(r.params(), "size", "1024x1024"), quality = str(r.params(), "quality", "auto");
        String format = str(r.params(), "outputFormat", "png");
        if (!List.of("png", "jpeg", "webp").contains(format)) throw ApiException.validation("输出格式必须为 png、jpeg 或 webp。");
        body.put("size", size); body.put("quality", quality);
        body.put("n", integer(r.params(), "n", 1));
        body.put("background", str(r.params(), "background", "auto"));
        body.put("output_format", format);
        if (!format.equals("png")) body.put("output_compression", integer(r.params(), "outputCompression", 100));
        if (!editing) body.put("moderation", str(r.params(), "moderation", "auto"));
        HttpRequest.BodyPublisher publisher;
        String contentType;
        if (editing) {
            String boundary = "----Studio" + UUID.randomUUID().toString().replace("-", "");
            publisher = HttpRequest.BodyPublishers.ofByteArray(multipart(body, r, boundary));
            contentType = "multipart/form-data; boundary=" + boundary;
        } else { publisher = HttpRequest.BodyPublishers.ofString(body.toString()); contentType = "application/json"; }
        JsonNode payload = send(URI.create(endpoint), publisher, contentType, "Bearer " + trim(r.apiKey()));
        String responseFormat = payload.path("output_format").asText(format);
        if (!List.of("png", "jpeg", "webp").contains(responseFormat)) responseFormat = format;
        String mime = "image/" + responseFormat;
        List<GeneratedImage> images = new ArrayList<>(); List<String> texts = new ArrayList<>();
        for (JsonNode item : payload.path("data")) {
            if (!item.isObject()) continue;
            if (item.path("b64_json").isTextual() && !item.path("b64_json").asText().isBlank()) images.add(new GeneratedImage(mime, item.path("b64_json").asText(), null));
            else if (item.path("url").isTextual() && !item.path("url").asText().isBlank()) images.add(new GeneratedImage(mime, null, resolve(endpoint, item.path("url").asText())));
            if (item.path("revised_prompt").isTextual() && !item.path("revised_prompt").asText().isBlank()) texts.add(item.path("revised_prompt").asText());
        }
        return result(r, "openai-compatible", images, String.join("\n", texts));
    }

    private ProviderResult gemini(GenerationRequest r) {
        String model = trim(r.model());
        if (model.isEmpty() || trim(r.apiKey()).isEmpty()) throw ApiException.validation("Gemini 配置无效。");
        String url = ProviderUrls.gemini(r.baseUrl(), model, trim(r.apiKey())).toASCIIString();
        ObjectNode body = mapper.createObjectNode();
        var contents = body.putArray("contents"); var parts = contents.addObject().put("role", "user").putArray("parts");
        parts.addObject().put("text", trim(r.prompt()));
        if (r.referenceImages() != null) for (var image : r.referenceImages()) parts.addObject().putObject("inlineData").put("mimeType", image.mimeType()).put("data", image.base64Data());
        ObjectNode params = r.params();
        ObjectNode config = body.putObject("generationConfig");
        var modalities = config.putArray("responseModalities");
        if (!str(params, "imageOnly", "false").equals("true")) modalities.add("TEXT");
        modalities.add("IMAGE");
        ObjectNode imageConfig = mapper.createObjectNode();
        String size = str(params, "imageSize", "auto");
        if (!size.equals("auto")) imageConfig.put("imageSize", size);
        String ratio = str(params, "aspectRatio", "auto");
        if (!ratio.equals("auto")) imageConfig.put("aspectRatio", ratio);
        if (!imageConfig.isEmpty()) config.set("imageConfig", imageConfig);
        String thinking = str(params, "thinkingLevel", "auto");
        if (!thinking.equals("auto")) config.putObject("thinkingConfig").put("thinkingLevel", thinking.toUpperCase(java.util.Locale.ROOT));
        JsonNode payload = send(URI.create(url), HttpRequest.BodyPublishers.ofString(body.toString()), "application/json", null);
        List<GeneratedImage> images = new ArrayList<>(); List<String> texts = new ArrayList<>();
        JsonNode candidates = payload.path("candidates");
        if (candidates.isArray() && !candidates.isEmpty()) for (JsonNode part : candidates.get(0).path("content").path("parts")) {
            JsonNode inline = part.has("inlineData") ? part.path("inlineData") : part.path("inline_data");
            if (inline.path("data").isTextual() && !inline.path("data").asText().isBlank()) images.add(new GeneratedImage(inline.path("mimeType").asText(inline.path("mime_type").asText("image/png")), inline.path("data").asText(), null));
            if (part.path("text").isTextual() && !part.path("text").asText().isBlank()) texts.add(part.path("text").asText());
        }
        return result(r, "gemini-compatible", images, String.join("\n", texts));
    }

    private JsonNode send(URI uri, HttpRequest.BodyPublisher publisher, String type, String authorization) {
        try {
            if (uri.getScheme() == null || (!uri.getScheme().equalsIgnoreCase("http") && !uri.getScheme().equalsIgnoreCase("https"))) throw ApiException.validation("Base URL 必须使用 HTTP(S)。");
            HttpRequest.Builder b = HttpRequest.newBuilder(uri).timeout(timeout).header("Content-Type", type).POST(publisher);
            if (authorization != null) b.header("Authorization", authorization);
            HttpResponse<byte[]> response = HttpBytes.send(client, b.build(), RESPONSE_LIMIT, timeout);
            int status = response.statusCode();
            if (status < 200 || status >= 300) {
                int codeStatus = status;
                String code = status == 401 || status == 403 ? "AUTH" : status == 429 || status == 425 ? "RATE_LIMIT" : status >= 500 || status == 408 || status == 504 ? "NETWORK" : status == 400 || status == 413 || status == 415 || status == 422 ? "VALIDATION" : "UNKNOWN";
                boolean retryable = code.equals("RATE_LIMIT") || code.equals("NETWORK");
                throw new ApiException(code, "供应商请求失败（HTTP " + status + "）。", codeStatus, retryable);
            }
            try {
                JsonNode payload = responseMapper.readTree(response.body());
                if (payload == null || !payload.isObject()) throw new ApiException("BAD_RESPONSE", "供应商返回了无效响应。", 502, false);
                return payload;
            } catch (ApiException e) { throw e; }
            catch (Exception e) { throw new ApiException("BAD_RESPONSE", "供应商返回了无效响应。", 502, false); }
        } catch (ApiException e) { throw e; }
        catch (IllegalArgumentException e) { throw new ApiException("VALIDATION", "供应商地址无效。", 400, false); }
    }

    private byte[] multipart(ObjectNode fields, GenerationRequest r, String boundary) {
        try {
            var out = new ByteArrayOutputStream();
            for (var it = fields.fields(); it.hasNext();) { var e = it.next(); part(out, boundary, e.getKey(), e.getValue().asText()); }
            int i = 1;
            for (var image : r.referenceImages()) {
                out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"reference-" + i++ + "." + image.mimeType().substring(image.mimeType().indexOf('/') + 1) + "\"\r\nContent-Type: " + image.mimeType() + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.write(Base64.getDecoder().decode(image.base64Data())); out.write("\r\n".getBytes(StandardCharsets.UTF_8));
            }
            out.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8)); return out.toByteArray();
        } catch (Exception e) { throw ApiException.validation("参考图片格式无效。"); }
    }
    private void part(ByteArrayOutputStream out, String b, String key, String value) throws IOException { out.write(("--" + b + "\r\nContent-Disposition: form-data; name=\"" + key + "\"\r\n\r\n" + value + "\r\n").getBytes(StandardCharsets.UTF_8)); }
    private String resolve(String base, String value) { try { return URI.create(base).resolve(value).toString(); } catch (Exception e) { return value; } }
    private ProviderResult result(GenerationRequest r, String provider, List<GeneratedImage> images, String text) {
        if (images.isEmpty()) throw new ApiException("BAD_RESPONSE", "供应商返回成功但未包含图片数据。", 502, false);
        return new ProviderResult(provider, r.model(), text.isEmpty() ? null : text, List.copyOf(images), Instant.now().toString());
    }
    private static String trim(String s) { return s == null ? "" : s.trim(); }
    private static String str(ObjectNode n, String k, String d) { return n != null && n.path(k).isValueNode() ? n.path(k).asText(d) : d; }
    private static int integer(ObjectNode n, String k, int d) { return n != null && n.path(k).canConvertToInt() ? n.path(k).asInt() : d; }
}
