package studio.api.storage;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import studio.api.auth.AuthService;

import java.util.Map;

@RestController
@RequestMapping("/api/admin/storage")
public class StorageAdminController {
    private final AuthService auth;
    private final StorageSettings storage;
    private final R2Client r2;

    public StorageAdminController(AuthService auth, StorageSettings storage, R2Client r2) {
        this.auth = auth; this.storage = storage; this.r2 = r2;
    }

    public record SettingsView(String activeBucketId, Integer retentionDays) {}
    public record UsageView(StorageSettings.ApplicationUsage application, R2Client.Usage cloudflare) {}

    @GetMapping("/settings") public SettingsView settings() {
        auth.requireAdmin();
        return view(storage.policy());
    }
    @PutMapping("/settings") public SettingsView settings(@RequestBody JsonNode input) {
        auth.requireAdmin();
        return view(storage.updatePolicy(input));
    }
    @GetMapping("/buckets") public Object buckets() {
        auth.requireAdmin();
        return Map.of("buckets", storage.list());
    }
    @PostMapping("/buckets") public Object create(@RequestBody JsonNode input) {
        auth.requireAdmin();
        return Map.of("bucket", storage.create(input));
    }
    @PatchMapping("/buckets/{id}") public Object rotate(@PathVariable String id, @RequestBody JsonNode input) {
        auth.requireAdmin();
        return Map.of("bucket", storage.rotate(id, input));
    }
    @DeleteMapping("/buckets/{id}") public Object delete(@PathVariable String id) {
        auth.requireAdmin();
        storage.delete(id);
        return Map.of("ok", true);
    }
    @GetMapping("/buckets/{id}/usage") public UsageView usage(@PathVariable String id) {
        auth.requireAdmin();
        StorageSettings.ApplicationUsage application = storage.applicationUsage(id);
        R2Client.Usage cloudflare;
        try {
            cloudflare = r2.usage(storage.bucket(id));
        } catch (RuntimeException e) {
            // Never expose provider exception text, which may contain credentials.
            cloudflare = new R2Client.Usage("unavailable", null, null, null, null);
        }
        return new UsageView(application, cloudflare);
    }
    private SettingsView view(StorageSettings.Policy policy) {
        return new SettingsView(policy.bucketId(), policy.retentionDays());
    }
}
