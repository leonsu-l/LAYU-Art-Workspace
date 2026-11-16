package studio.api.channel;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.auth.UserPrincipal;
import studio.api.common.ApiException;
import studio.api.common.DatabaseTransactions;
import studio.api.common.Json;
import studio.api.common.SecretBox;
import studio.api.task.RequestParser;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class ModelCatalogTest {
    @TempDir Path directory;
    HttpServer server;
    String origin;
    Json json = new Json(new ObjectMapper());
    @AfterEach void stop() { if (server != null) server.stop(0); }
    void start(com.sun.net.httpserver.HttpHandler handler) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", handler);
        server.start();
        origin = "http://127.0.0.1:" + server.getAddress().getPort();
    }
    static void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String body) throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
    @Test void openAiUsesChannelCredentialsAndDoesNotGuessImageCapabilities() throws Exception {
        AtomicReference<String> request = new AtomicReference<>();
        start(exchange -> {
            request.set(exchange.getRequestURI() + "|" + exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange, 200, "{\"data\":[{\"id\":\"future-image-model\"},{\"id\":\"chat-model\"}]}");
        });
        var models = new ModelCatalog(json).discover("openai-compatible", origin + "/v1/images/generations", "channel-key");
        assertEquals("/v1/models|Bearer channel-key", request.get());
        assertEquals(2, models.size());
        assertEquals("future-image-model", models.getFirst().id());
    }
    @Test void geminiReadsAllPagesAndStripsOnlyModelsPrefix() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        start(exchange -> {
            assertEquals("gemini-key", exchange.getRequestHeaders().getFirst("x-goog-api-key"));
            assertFalse(exchange.getRequestURI().toString().contains("gemini-key"));
            if (calls.getAndIncrement() == 0) respond(exchange, 200, "{\"models\":[{\"name\":\"models/new-image\",\"displayName\":\"新模型\"}],\"nextPageToken\":\"page two\"}");
            else { assertTrue(exchange.getRequestURI().toString().contains("pageToken=page+two")); respond(exchange, 200, "{\"models\":[{\"name\":\"models/another\"}]}"); }
        });
        var models = new ModelCatalog(json).discover("gemini-compatible", origin + "/v1beta", "gemini-key");
        assertEquals(2, calls.get());
        assertEquals("new-image", models.getFirst().id());
        assertEquals("新模型", models.getFirst().name());
    }
    @Test void malformedDirectoryIsNotMistakenForAnEmptySuccessfulCache() throws Exception {
        start(exchange -> respond(exchange, 200, "{\"unexpected\":true}"));
        assertThrows(ApiException.class, () -> new ModelCatalog(json).discover("openai-compatible", origin, "key"));
    }
    @Test void failedRefreshKeepsCacheAndSharedUsersOnlySeeEnabledModels() throws Exception {
        AtomicBoolean fail = new AtomicBoolean();
        start(exchange -> { if (fail.get()) respond(exchange, 401, "secret-key diagnostic"); else respond(exchange, 200, "{\"data\":[{\"id\":\"discovered-one\"},{\"id\":\"not-enabled\"}]}"); });
        var ds = new DriverManagerDataSource("jdbc:h2:mem:catalog-" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        Flyway.configure().dataSource(ds).load().migrate();
        var db = new JdbcTemplate(ds);
        var tx = new DatabaseTransactions(db, new TransactionTemplate(new DataSourceTransactionManager(ds)));
        var service = new ChannelService(db, tx, json, new SecretBox(directory.toString(), ""), new ModelCatalog(json), new RequestParser(json), event -> {});
        UserPrincipal admin = new UserPrincipal(UUID.randomUUID().toString(), "admin", "ADMIN", false);
        UserPrincipal user = new UserPrincipal(UUID.randomUUID().toString(), "user", "USER", false);
        var body = json.object().put("scope", "shared").put("name", "Shared").put("provider", "openai-compatible").put("baseUrl", origin).put("apiKey", "secret-key");
        body.putArray("enabledModels").add("discovered-one").add("manual-model");
        String id = service.create(admin, body).path("id").asText();
        service.refresh(admin, id);
        var visible = service.models(user, id);
        assertEquals(2, visible.path("models").size());
        assertFalse(visible.toString().contains("not-enabled"));
        assertFalse(service.list(user).toString().contains("secret-key"));
        String updated = visible.path("updatedAt").asText();
        fail.set(true);
        var failed = service.refresh(admin, id);
        assertEquals(updated, failed.path("updatedAt").asText());
        assertTrue(failed.path("stale").asBoolean());
        assertTrue(failed.path("error").asText().contains("401"));
        assertFalse(failed.toString().contains("secret-key"));
        assertEquals(3, failed.path("models").size());
        assertThrows(ApiException.class, () -> service.refresh(user, id));
    }
}
