package studio.api.storage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.core.retry.RetryPolicy;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.http.SdkHttpClient;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.S3Exception;
import studio.api.common.ApiException;
import studio.api.common.HttpBytes;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

@Component
public class R2Client {
    private static final int MAX_IMAGE_BYTES = 25 * 1024 * 1024;
    private static final Duration TIMEOUT = Duration.ofSeconds(60);
    private static final Duration ANALYTICS_TIMEOUT = Duration.ofSeconds(10);
    private static final URI GRAPHQL = URI.create("https://api.cloudflare.com/client/v4/graphql");
    private static final Pattern FILENAME = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\.(png|jpg|gif|webp)");
    private static final String QUERY = """
            query R2Storage($accountTag: string!, $bucketName: string, $startDate: Time, $endDate: Time) {
              viewer { accounts(filter: {accountTag: $accountTag}) {
                r2StorageAdaptiveGroups(limit: 1, filter: {bucketName: $bucketName, datetime_geq: $startDate, datetime_leq: $endDate}, orderBy: [datetime_DESC]) {
                  max { payloadSize metadataSize objectCount } dimensions { datetime }
                }
              } }
            }
            """;
    private static final ObjectMapper JSON = new ObjectMapper();
    private final SdkHttpClient sdkHttp;
    private final HttpClient analyticsHttp;

    public R2Client() {
        this(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(10)).socketTimeout(TIMEOUT).build(),
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build());
    }

    // Injection is package-private so tests can intercept requests without permitting arbitrary production endpoints.
    R2Client(SdkHttpClient sdkHttp, HttpClient analyticsHttp) {
        this.sdkHttp = sdkHttp;
        this.analyticsHttp = analyticsHttp;
    }

    public void put(R2Bucket bucket, String filename, String mimeType, byte[] bytes) {
        String key = key(filename);
        if (bytes == null || mimeType == null || !mimeType.matches("image/(png|jpeg|gif|webp)")) throw ApiException.validation("图片内容无效。");
        try (S3Client client = client(bucket)) {
            client.putObject(b -> b.bucket(bucket.bucketName()).key(key).contentType(mimeType), RequestBody.fromBytes(bytes));
        } catch (S3Exception exception) { throw storageFailure(exception); }
        catch (SdkClientException exception) { throw sdkFailure(exception); }
        catch (Exception ignored) { throw storageFailure(); }
    }

    public byte[] read(R2Bucket bucket, String filename) {
        String key = key(filename);
        try (S3Client client = client(bucket)) {
            // The synchronous transformer runs within the SDK apiCallTimeout and closes on all paths.
            return client.getObject(b -> b.bucket(bucket.bucketName()).key(key), (response, stream) -> {
                if (response.contentLength() != null && response.contentLength() > MAX_IMAGE_BYTES) throw storageFailure();
                byte[] bytes = stream.readNBytes(MAX_IMAGE_BYTES + 1);
                if (bytes.length > MAX_IMAGE_BYTES) throw storageFailure();
                return bytes;
            });
        } catch (S3Exception exception) {
            if (exception.statusCode() == 404 && exception.awsErrorDetails() != null
                    && "NoSuchKey".equals(exception.awsErrorDetails().errorCode())) throw ApiException.notFound();
            throw storageFailure(exception);
        } catch (SdkClientException exception) { throw sdkFailure(exception); }
        catch (Exception ignored) { throw storageFailure(); }
    }

    public void delete(R2Bucket bucket, String filename) {
        String key = key(filename);
        try (S3Client client = client(bucket)) {
            client.deleteObject(b -> b.bucket(bucket.bucketName()).key(key));
        } catch (S3Exception exception) {
            if (exception.statusCode() == 404 && exception.awsErrorDetails() != null
                    && "NoSuchKey".equals(exception.awsErrorDetails().errorCode())) return;
            throw storageFailure(exception);
        } catch (SdkClientException exception) { throw sdkFailure(exception); }
        catch (Exception ignored) { throw storageFailure(); }
    }

    @PreDestroy
    public void close() {
        sdkHttp.close();
        analyticsHttp.close();
    }

    public record Usage(String status, Long payloadBytes, Long metadataBytes, Long objectCount, Instant sampledAt) { }

    public Usage usage(R2Bucket bucket) {
        if (bucket == null || bucket.analyticsToken() == null || bucket.analyticsToken().isBlank()) return status("not_configured");
        try {
            validate(bucket);
            Instant end = Instant.now().truncatedTo(ChronoUnit.SECONDS);
            String analyticsBucket = "default".equals(bucket.jurisdiction()) ? bucket.bucketName() : bucket.jurisdiction() + "_" + bucket.bucketName();
            byte[] body = JSON.writeValueAsBytes(Map.of("query", QUERY, "variables", Map.of(
                    "accountTag", bucket.accountId(), "bucketName", analyticsBucket,
                    "startDate", end.minus(Duration.ofDays(31)).toString(), "endDate", end.toString())));
            HttpRequest request = HttpRequest.newBuilder(GRAPHQL).timeout(ANALYTICS_TIMEOUT)
                    .header("Authorization", "Bearer " + bucket.analyticsToken())
                    .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
            var response = HttpBytes.send(analyticsHttp, request, 1024 * 1024, ANALYTICS_TIMEOUT);
            if (response.statusCode() == 401 || response.statusCode() == 403) return status("forbidden");
            if (response.statusCode() < 200 || response.statusCode() >= 300) return status("unavailable");
            JsonNode root = JSON.readTree(response.body());
            if (root == null || !root.isObject()) return status("unavailable");
            JsonNode errors = root.path("errors");
            if (errors.isArray() && !errors.isEmpty()) {
                for (JsonNode error : errors) {
                    String message = error.path("message").asText("").toLowerCase(Locale.ROOT);
                    if (message.contains("permission") || message.contains("forbidden") || message.contains("unauthorized") || message.contains("not authorized") || error.path("extensions").path("code").asInt(-1) == 10000) return status("forbidden");
                }
                return status("unavailable");
            }
            if (!errors.isMissingNode() && !errors.isNull() && !errors.isArray()) return status("unavailable");
            JsonNode accounts = root.path("data").path("viewer").path("accounts");
            if (!accounts.isArray()) return status("unavailable");
            if (accounts.isEmpty()) return status("no_data");
            JsonNode groups = accounts.get(0).path("r2StorageAdaptiveGroups");
            if (!groups.isArray()) return status("unavailable");
            if (groups.isEmpty()) return status("no_data");
            JsonNode max = groups.get(0).path("max");
            Long payload = number(max.path("payloadSize")), metadata = number(max.path("metadataSize")), count = number(max.path("objectCount"));
            JsonNode datetime = groups.get(0).path("dimensions").path("datetime");
            if (payload == null || metadata == null || count == null || !datetime.isTextual()) return status("unavailable");
            return new Usage("available", payload, metadata, count, Instant.parse(datetime.textValue()));
        } catch (Exception ignored) { return status("unavailable"); }
    }

    private static Long number(JsonNode n) {
        return n.isIntegralNumber() && n.canConvertToLong() && n.longValue() >= 0 ? n.longValue() : null;
    }
    private static Usage status(String status) { return new Usage(status, null, null, null, null); }
    private static String key(String filename) {
        if (filename == null || !FILENAME.matcher(filename).matches()) throw ApiException.validation("图片路径无效。");
        return "layu/images/" + filename;
    }
    private static void validate(R2Bucket bucket) {
        if (bucket == null || bucket.accountId() == null || !bucket.accountId().matches("[a-fA-F0-9]{32}")
                || bucket.bucketName() == null || !bucket.bucketName().matches("[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]")
                || bucket.bucketName().contains("..") || bucket.jurisdiction() == null
                || !java.util.Set.of("default", "eu", "fedramp").contains(bucket.jurisdiction())) throw new IllegalArgumentException();
    }
    private S3Client client(R2Bucket bucket) {
        validate(bucket);
        if (bucket.accessKeyId() == null || bucket.accessKeyId().isBlank() || bucket.secretAccessKey() == null || bucket.secretAccessKey().isBlank()) throw new IllegalArgumentException();
        String suffix = "default".equals(bucket.jurisdiction()) ? "" : "." + bucket.jurisdiction();
        return S3Client.builder().endpointOverride(URI.create("https://" + bucket.accountId() + suffix + ".r2.cloudflarestorage.com"))
                .region(Region.of("auto"))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(bucket.accessKeyId(), bucket.secretAccessKey())))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build())
                .overrideConfiguration(ClientOverrideConfiguration.builder().apiCallTimeout(TIMEOUT).apiCallAttemptTimeout(TIMEOUT)
                        .retryPolicy(RetryPolicy.none()).build())
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
                .httpClient(sdkHttp).build();
    }
    private static ApiException storageFailure(S3Exception exception) {
        int status = exception.statusCode();
        if (status == 401 || status == 403) return new ApiException("AUTH", "对象存储操作失败。", 502, false);
        if (status == 429) return new ApiException("RATE_LIMIT", "对象存储操作失败。", 502, true);
        return storageFailure();
    }
    private static ApiException sdkFailure(SdkClientException exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof java.io.IOException || cause instanceof java.util.concurrent.TimeoutException
                    || cause instanceof software.amazon.awssdk.core.exception.ApiCallTimeoutException
                    || cause instanceof software.amazon.awssdk.core.exception.ApiCallAttemptTimeoutException) {
                return new ApiException("NETWORK", "对象存储操作失败。", 502, true);
            }
        }
        return storageFailure();
    }
    private static ApiException storageFailure() { return new ApiException("STORAGE", "对象存储操作失败。", 502, true); }
}
