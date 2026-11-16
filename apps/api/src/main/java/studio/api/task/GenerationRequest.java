package studio.api.task;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** Immutable execution snapshot; never serialize this object in a public API response. */
public record GenerationRequest(String provider, String model, String baseUrl, String apiKey,
                                ObjectNode params, String prompt, List<ReferenceImage> referenceImages) {
    public record ReferenceImage(String name, String mimeType, String base64Data) {}
}
