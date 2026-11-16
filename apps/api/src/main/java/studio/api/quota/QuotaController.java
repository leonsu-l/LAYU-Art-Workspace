package studio.api.quota;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import studio.api.auth.AuthService;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class QuotaController {
    private final QuotaService quota;
    private final AuthService auth;
    public QuotaController(QuotaService quota, AuthService auth) { this.quota = quota; this.auth = auth; }
    @GetMapping("/me/quota") public Object current() { return quota.current(auth.requireUser().id()); }
    @GetMapping("/admin/settings") public Object settings() { auth.requireAdmin(); return Map.of("settings", quota.settings()); }
    @PutMapping("/admin/settings") public Object settings(@RequestBody JsonNode input) { auth.requireAdmin(); return Map.of("settings", quota.update(input)); }
    @GetMapping("/admin/usage") public Object usage() { auth.requireAdmin(); return quota.usage(); }
}
