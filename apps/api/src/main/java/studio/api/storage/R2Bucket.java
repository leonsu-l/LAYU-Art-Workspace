package studio.api.storage;

/** Internal credentials and configuration; never expose this record as an API response. */
public record R2Bucket(String id, String accountId, String bucketName, String jurisdiction,
                       String accessKeyId, String secretAccessKey, String analyticsToken) {
    @Override public String toString() { return "R2Bucket[redacted]"; }
}
