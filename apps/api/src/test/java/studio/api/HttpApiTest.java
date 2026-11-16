package studio.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import studio.api.auth.AuthService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:http;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE",
        "spring.datasource.username=sa", "spring.datasource.password=", "studio.worker-enabled=false",
        "BOOTSTRAP_ADMIN_USERNAME=", "BOOTSTRAP_ADMIN_PASSWORD="})
@AutoConfigureMockMvc
class HttpApiTest {
    private static final Path DIRECTORY = temporary();
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) { registry.add("studio.data-dir", DIRECTORY::toString); }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AuthService auth;

    @Test void acceptsChannelBasedRequestsWithoutReturningCredentialsAndKeepsOwnerIsolation() throws Exception {
        Client admin = admin();
        String channelBody = mapper.writeValueAsString(Map.of("scope", "private", "provider", "openai-compatible", "name", "Private", "baseUrl", "http://localhost:9", "apiKey", "never-return-this-key"));
        String channel = mvc.perform(with(admin, post("/api/channels")).content(channelBody)).andExpect(status().isOk())
                .andExpect(content().string(not(containsString("never-return-this-key"))))
                .andReturn().getResponse().getContentAsString();
        String channelId = mapper.readTree(channel).path("channel").path("id").asText();
        String id = UUID.randomUUID().toString();
        String body = mapper.writeValueAsString(Map.of("id", id, "prompt", "test prompt", "channelId", channelId, "model", "brand-new-model", "params", Map.of("n", 1)));
        mvc.perform(with(admin, post("/api/tasks")).content(body)).andExpect(status().isAccepted())
                .andExpect(jsonPath("$.task.status").value("queued")).andExpect(jsonPath("$.task.model").value("brand-new-model"))
                .andExpect(content().string(not(containsString("never-return-this-key"))));
        mvc.perform(with(admin, post("/api/tasks")).content(body)).andExpect(status().isAccepted());
        mvc.perform(with(admin, post("/api/tasks")).content(body.replace("test prompt", "different prompt"))).andExpect(status().isConflict());
        mvc.perform(with(admin, get("/api/tasks/" + id))).andExpect(status().isOk()).andExpect(jsonPath("$.task.referenceImageCount").value(0));
        mvc.perform(with(admin, delete("/api/tasks/" + id))).andExpect(status().isConflict());

        Client other = register(admin);
        mvc.perform(with(other, get("/api/tasks/" + id))).andExpect(status().isNotFound());
        mvc.perform(with(other, get("/api/channels/" + channelId + "/models"))).andExpect(status().isNotFound());
        mvc.perform(with(other, get("/api/admin/users"))).andExpect(status().isForbidden());
        mvc.perform(with(other, post("/api/channels")).content(channelBody.replace("private", "shared"))).andExpect(status().isForbidden());
        mvc.perform(with(other, get("/api/tasks"))).andExpect(jsonPath("$.tasks").isEmpty());
    }

    @Test void validatesInputsCsrfAndAnonymousAccess() throws Exception {
        mvc.perform(get("/api/auth/session")).andExpect(status().isOk()).andExpect(jsonPath("$.user").value(nullValue()));
        mvc.perform(get("/api/tasks")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login").contentType("application/json").content("{}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("AUTH"));
        Client client = admin();
        mvc.perform(with(client, post("/api/tasks")).content("{}")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION"));
        mvc.perform(get("/api/health").header("Sec-Fetch-Site", "cross-site")).andExpect(status().isForbidden());
        mvc.perform(get("/api/health")).andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true));
        mvc.perform(with(client, get("/api/images/unregistered.png"))).andExpect(status().isNotFound());
        mvc.perform(with(client, post("/api/gallery/delete")).content("{\"ids\":[\"invalid\"]}"))
                .andExpect(status().isBadRequest());
    }

    @Test void sharedModelsAndSecretsAreControlledByAdministrator() throws Exception {
        Client admin = admin();
        String body = mapper.writeValueAsString(Map.of("scope", "shared", "provider", "gemini-compatible", "name", "Shared", "baseUrl", "http://localhost:9/v1beta", "apiKey", "shared-hidden-key", "enabledModels", java.util.List.of("manual-image-model")));
        String channel = mvc.perform(with(admin, post("/api/channels")).content(body)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String id = mapper.readTree(channel).path("channel").path("id").asText();
        Client user = register(admin);
        mvc.perform(with(user, get("/api/channels"))).andExpect(status().isOk()).andExpect(content().string(not(containsString("shared-hidden-key"))));
        mvc.perform(with(user, get("/api/channels/" + id + "/models"))).andExpect(jsonPath("$.models[0].id").value("manual-image-model"));
        mvc.perform(with(user, post("/api/channels/" + id + "/models/refresh")).content("{}")).andExpect(status().isForbidden());
        mvc.perform(with(user, get("/api/me/quota"))).andExpect(status().isOk()).andExpect(jsonPath("$.configured").value(false));
    }

    private Client admin() throws Exception {
        auth.bootstrap("test.admin", "administrator-test-password");
        Cookie csrf = csrf();
        var response = mvc.perform(post("/api/auth/login").cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                .contentType("application/json").content("{\"username\":\"test.admin\",\"password\":\"administrator-test-password\"}"))
                .andExpect(status().isOk()).andReturn().getResponse();
        Cookie session = response.getCookie("STUDIO_SESSION");
        assertNotNull(session);
        return new Client(session, csrf);
    }
    private Client register(Client admin) throws Exception {
        String response = mvc.perform(with(admin, post("/api/admin/invites")).content("{}")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String invite = mapper.readTree(response).path("invite").path("code").asText();
        Cookie csrf = csrf();
        var registered = mvc.perform(post("/api/auth/register").cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue()).contentType("application/json")
                .content(mapper.writeValueAsString(Map.of("username", "user." + UUID.randomUUID(), "password", "ordinary-user-password", "inviteCode", invite))))
                .andExpect(status().isOk()).andReturn().getResponse();
        return new Client(registered.getCookie("STUDIO_SESSION"), csrf);
    }
    private Cookie csrf() throws Exception {
        Cookie cookie = mvc.perform(get("/api/auth/session")).andExpect(status().isOk()).andReturn().getResponse().getCookie("XSRF-TOKEN");
        assertNotNull(cookie);
        return cookie;
    }
    private MockHttpServletRequestBuilder with(Client c, MockHttpServletRequestBuilder request) {
        return request.cookie(c.session, c.csrf).header("X-XSRF-TOKEN", c.csrf.getValue()).contentType("application/json");
    }
    private record Client(Cookie session, Cookie csrf) {}
    private static Path temporary() {
        try { return Files.createTempDirectory("studio-http-test-"); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
