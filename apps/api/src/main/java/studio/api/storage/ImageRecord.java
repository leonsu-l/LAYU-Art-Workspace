package studio.api.storage;

/** Public image metadata. Physical locations and credentials never belong in this record. */
public record ImageRecord(
        String id,
        String createdAt,
        String provider,
        String model,
        String prompt,
        String mimeType,
        long bytes,
        String url,
        Integer retentionDays,
        String expiresAt) {
    ImageRecord withExpiry(Integer days, String expiry) {
        return new ImageRecord(id, createdAt, provider, model, prompt, mimeType, bytes, url, days, expiry);
    }
}
