package studio.api.ops;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import studio.api.auth.AuthService;

import java.util.Map;

@RestController
@RequestMapping("/api/admin/issues")
public class OpsIssuesController {
    private final AuthService auth;
    private final OpsIssues issues;

    public OpsIssuesController(AuthService auth, OpsIssues issues) {
        this.auth = auth;
        this.issues = issues;
    }

    @GetMapping
    public OpsIssues.Page list(@RequestParam(defaultValue = "0") int page,
                               @RequestParam(defaultValue = "20") int size,
                               @RequestParam(required = false) String status) {
        auth.requireAdmin();
        return issues.list(page, size, status);
    }

    @GetMapping("/summary")
    public Map<String, Long> summary() {
        auth.requireAdmin();
        return Map.of("openCount", issues.openCount());
    }

    @PostMapping("/{id}/resolve")
    public Map<String, Boolean> resolve(@PathVariable String id) {
        auth.requireAdmin();
        issues.resolve(id);
        return Map.of("ok", true);
    }
}
