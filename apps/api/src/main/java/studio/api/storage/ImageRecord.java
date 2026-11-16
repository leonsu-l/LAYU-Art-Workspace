package studio.api.storage;

public record ImageRecord(
        String id,
        String createdAt,
        String provider,
        String model,
        String prompt,
        String mimeType,
        long bytes,
        String url) {
}
