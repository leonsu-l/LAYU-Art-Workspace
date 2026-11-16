package studio.api.provider;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import studio.api.common.ApiException;
import studio.api.task.GenerationRequest;

import java.net.InetSocketAddress;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class ProviderServiceTest {
    private HttpServer server;
    private String origin;
    private final ProviderService service = new ProviderService(new ObjectMapper());

    private void start(java.util.function.BiConsumer<com.sun.net.httpserver.HttpExchange, byte[]> handler) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes(); handler.accept(exchange, body);
        });
        server.start(); origin = "http://127.0.0.1:" + server.getAddress().getPort();
    }
    @AfterEach void stop() { if (server != null) server.stop(0); }
    private static void respond(com.sun.net.httpserver.HttpExchange x, int status, String body) {
        try { byte[] bytes = body.getBytes(StandardCharsets.UTF_8); x.getResponseHeaders().add("Content-Type", "application/json"); x.sendResponseHeaders(status, bytes.length); x.getResponseBody().write(bytes); x.close(); }
        catch (Exception ignored) { }
    }
    private GenerationRequest request(String provider, String model, String base, String key, String prompt) {
        return new GenerationRequest(provider, model, base, key, JsonNodeFactory.instance.objectNode(), prompt, List.of());
    }

    @Test void openAiBuildsGenerationJsonAndParsesResults() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        start((x, body) -> { seen.set(x.getRequestURI() + "|" + x.getRequestHeaders().getFirst("Authorization") + "|" + new String(body, StandardCharsets.UTF_8));
            respond(x, 200, "{\"data\":[{\"b64_json\":\"aW1hZ2U=\",\"revised_prompt\":\"revision\"},{\"url\":\"/image.png\"}]}"); });
        var r = request("openai-compatible", "image-model", origin + "/v1/", "secret", "  prompt  ");
        ProviderResult result = service.generate(r);
        assertTrue(seen.get().startsWith("/v1/images/generations|Bearer secret|"));
        assertTrue(seen.get().contains("\"prompt\":\"prompt\""));
        assertEquals("revision", result.text()); assertEquals("aW1hZ2U=", result.images().get(0).base64Data());
        assertEquals(origin + "/image.png", result.images().get(1).url());
    }

    @Test void openAiReferenceUsesMultipartEdits() throws Exception {
        AtomicReference<String> contentType = new AtomicReference<>(); AtomicReference<String> bodyText = new AtomicReference<>();
        start((x, body) -> { contentType.set(x.getRequestHeaders().getFirst("Content-Type")); bodyText.set(new String(body, StandardCharsets.ISO_8859_1)); respond(x, 200, "{\"data\":[{\"b64_json\":\"aW1hZ2U=\"}]}"); });
        var image = new GenerationRequest.ReferenceImage("x.png", "image/png", "aW1hZ2U=");
        var r = new GenerationRequest("openai-compatible", "gpt-image-2", origin, "k", JsonNodeFactory.instance.objectNode(), "edit", List.of(image));
        service.generate(r);
        assertTrue(contentType.get().startsWith("multipart/form-data; boundary="));
        assertTrue(bodyText.get().contains("name=\"image[]\""));
        assertTrue(bodyText.get().contains("\r\n\r\nimage\r\n"));
        assertFalse(bodyText.get().contains("aW1hZ2U="), "multipart uploads decoded image bytes, not base64 text");
    }

    @Test void geminiSendsReferencesAndParsesSnakeCaseParts() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        start((x, body) -> { seen.set(x.getRequestURI() + " " + new String(body, StandardCharsets.UTF_8));
            respond(x, 200, "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ok\"},{\"inline_data\":{\"data\":\"aW1hZ2U=\",\"mime_type\":\"image/jpeg\"}}]}}]}"); });
        var image = new GenerationRequest.ReferenceImage("ref.png", "image/png", "cmVm");
        var r = new GenerationRequest("gemini-compatible", "gemini image/test", origin + "/v1beta/", "a & b", JsonNodeFactory.instance.objectNode(), " draw ", List.of(image));
        var result = service.generate(r);
        assertTrue(seen.get().startsWith("/v1beta/models/gemini%20image%2Ftest:generateContent?key=a%20%26%20b"));
        assertTrue(seen.get().contains("\"inlineData\"")); assertEquals("ok", result.text());
        assertEquals("image/jpeg", result.images().get(0).mimeType());
    }

    @Test void redirectsDoNotForwardCredentialsAndProviderErrorsDoNotLeakBody() throws Exception {
        start((x, body) -> { x.getResponseHeaders().add("Location", "http://127.0.0.1:1/elsewhere"); respond(x, 302, "secret prompt diagnostic"); });
        ApiException error = assertThrows(ApiException.class, () -> service.generate(request("openai-compatible", "m", origin, "private-key", "private prompt")));
        assertFalse(error.getMessage().contains("private-key")); assertFalse(error.getMessage().contains("private prompt"));
        assertFalse(error.getMessage().contains("diagnostic")); assertEquals(302, error.status());
    }

    @Test void rejectsUnsupportedProviderAndInvalidProtocol() {
        assertThrows(ApiException.class, () -> service.generate(request("other", "m", "http://localhost", "k", "p")));
        assertThrows(ApiException.class, () -> service.generate(request("openai-compatible", "m", "file:///tmp/x", "k", "p")));
    }

    @Test void stalledResponseBodyIsBoundedByTheWholeExchangeDeadline() throws Exception {
        start((x, body) -> {
            try {
                x.getResponseHeaders().add("Content-Type", "application/json");
                x.sendResponseHeaders(200, 0);
                x.getResponseBody().write("{\"data\":".getBytes(StandardCharsets.UTF_8));
                x.getResponseBody().flush();
                Thread.sleep(1_000);
                x.close();
            } catch (Exception ignored) { }
        });
        ProviderService shortTimeout = new ProviderService(new ObjectMapper(), Duration.ofMillis(150));
        long started = System.nanoTime();
        ApiException error = assertThrows(ApiException.class, () -> shortTimeout.generate(request("openai-compatible", "m", origin, "never-echo-this-key", "never-echo-this-prompt")));
        assertEquals("NETWORK", error.code());
        assertTrue(Duration.ofNanos(System.nanoTime() - started).toMillis() < 900);
        assertFalse(error.getMessage().contains("never-echo-this-key"));
        assertFalse(error.getMessage().contains("never-echo-this-prompt"));
    }

    @Test void upstreamErrorBodyCannotLeakCredentialsOrPrompt() throws Exception {
        start((x, body) -> respond(x, 401, "{\"error\":{\"message\":\"never-echo-this-key never-echo-this-prompt\"}}"));
        ApiException error = assertThrows(ApiException.class, () -> service.generate(request("openai-compatible", "m", origin, "never-echo-this-key", "never-echo-this-prompt")));
        assertEquals("AUTH", error.code());
        assertFalse(error.getMessage().contains("never-echo-this-key"));
        assertFalse(error.getMessage().contains("never-echo-this-prompt"));
    }

    @Test void customOpenAiEndpointKeepsQueryParametersAndSharesItsDiscoveryRoot() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        start((x, body) -> { seen.set(x.getRequestURI().toString()); respond(x, 200, "{\"data\":[{\"b64_json\":\"aW1hZ2U=\"}]}"); });
        String address = origin + "/gateway/images/generations?tenant=design%2Fteam&label=x/";
        service.generate(request("openai-compatible", "image-model", address, "key", "prompt"));
        assertEquals("/gateway/images/generations?tenant=design%2Fteam&label=x/", seen.get());
        assertEquals(origin + "/gateway/models?tenant=design%2Fteam&label=x/", ProviderUrls.models("openai-compatible", address).toString());
        assertEquals(address, studio.api.task.RequestParser.baseUrl(JsonNodeFactory.instance.textNode(address)));
    }

    @Test void geminiFullEndpointUsesSelectedModelInsteadOfAnOldModelEmbeddedInTheAddress() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        start((x, body) -> { seen.set(x.getRequestURI().toString()); respond(x, 200, "{\"candidates\":[{\"content\":{\"parts\":[{\"inlineData\":{\"data\":\"aW1hZ2U=\"}}]}}]}"); });
        String address = origin + "/v1beta/models/old-model:generateContent?tenant=1&key=obsolete";
        service.generate(request("gemini-compatible", "selected-new-model", address, "new-key", "prompt"));
        assertEquals("/v1beta/models/selected-new-model:generateContent?tenant=1&key=new-key", seen.get());
        assertEquals(origin + "/v1beta/models?tenant=1", ProviderUrls.models("gemini-compatible", address).toString());
        assertEquals(origin + "/v1beta/models/next:generateContent?key=k", ProviderUrls.gemini(origin, "models/next", "k").toString());
    }

    @Test void unknownGeminiModelPreservesExplicitSizeAndThinkingOptions() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        start((x, body) -> { seen.set(new String(body, StandardCharsets.UTF_8)); respond(x, 200, "{\"candidates\":[{\"content\":{\"parts\":[{\"inlineData\":{\"data\":\"aW1hZ2U=\"}}]}}]}"); });
        var params = JsonNodeFactory.instance.objectNode().put("imageSize", "1K").put("thinkingLevel", "high");
        var r = new GenerationRequest("gemini-compatible", "brand-new-image-model", origin, "k", params, "p", List.of());
        service.generate(r);
        assertTrue(seen.get().contains("\"imageSize\":\"1K\""));
        assertTrue(seen.get().contains("\"thinkingLevel\":\"HIGH\""));
    }
}
