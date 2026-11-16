package studio.api.task;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import studio.api.common.ApiException;
import studio.api.storage.ImageStorage;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class TaskController {
    private final TaskStore tasks;
    private final studio.api.auth.AuthService auth;
    private final ImageStorage images;
    public TaskController(TaskStore tasks, studio.api.auth.AuthService auth, ImageStorage images) {
        this.tasks = tasks; this.auth = auth; this.images = images;
    }
    private String owner() { return auth.requireUser().id(); }
    @GetMapping("/health") public Map<String, Boolean> health() { return Map.of("ok", true); }
    @GetMapping("/tasks") public Object list() { return Map.of("tasks", tasks.list(owner())); }
    @GetMapping("/tasks/{id}") public Object get(@PathVariable String id) { return Map.of("task", tasks.get(owner(), id)); }
    @PostMapping(value = "/tasks", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> create(@RequestBody JsonNode input) {
        return ResponseEntity.accepted().body(Map.of("task", tasks.submit(auth.requireUser(), input)));
    }
    @DeleteMapping("/tasks/{id}") public Object deleteTask(@PathVariable String id) {
        if (!RequestParser.UUID_PATTERN.matcher(id).matches()) throw ApiException.notFound();
        return tasks.deleteTask(owner(), id);
    }
    @GetMapping("/gallery") public Object gallery() { return Map.of("images", tasks.gallery(owner())); }
    @GetMapping("/gallery/stats") public Object stats() { return tasks.stats(owner()); }
    @DeleteMapping("/gallery/{id}") public Object deleteImage(@PathVariable String id) {
        if (!RequestParser.UUID_PATTERN.matcher(id).matches()) throw ApiException.notFound();
        return Map.of("deletedCount", tasks.deleteImages(owner(), java.util.List.of(id)));
    }
    @PostMapping(value = "/gallery/delete", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object deleteImages(@RequestBody JsonNode input) {
        JsonNode values = input.path("ids");
        if (!values.isArray() || values.size() > 1000) throw ApiException.validation("图片列表无效，每批最多 1000 张。");
        var ids = new LinkedHashSet<String>();
        values.forEach(value -> ids.add(RequestParser.id(value)));
        return Map.of("deletedCount", tasks.deleteImages(owner(), new ArrayList<>(ids)));
    }
    @GetMapping("/images/{filename}") public ResponseEntity<byte[]> image(@PathVariable String filename) {
        var record = tasks.image(owner(), "/api/images/" + filename);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(record.mimeType()))
                .header("Content-Security-Policy", "default-src 'none'; sandbox")
                .body(images.read(record.url()));
    }
}
