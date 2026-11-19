package studio.api.storage;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.http.*;
import studio.api.common.ApiException;

import java.io.ByteArrayInputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class R2ClientTest {
    private static final String ACCOUNT = "0123456789abcdef0123456789abcdef";
    private static final String NAME = "a0123456-0123-4567-89ab-0123456789ab_b0123456-0123-4567-89ab-0123456789ab.png";
    private static final R2Bucket BUCKET = new R2Bucket("id", ACCOUNT, "pictures", "eu", "access", "secret", "analytics-secret");

    @Test void signedPathStyleRequestsAndNoOptionalChecksumOrChunking() throws Exception {
        var captured = new AtomicReference<HttpExecuteRequest>();
        SdkHttpClient transport = mock(SdkHttpClient.class);
        when(transport.prepareRequest(any())).thenAnswer(invocation -> {
            captured.set(invocation.getArgument(0));
            return response(200, "");
        });
        R2Client client = new R2Client(transport, mock(HttpClient.class));
        client.put(BUCKET, NAME, "image/png", new byte[]{1, 2, 3});
        SdkHttpRequest request = captured.get().httpRequest();
        assertEquals(ACCOUNT + ".eu.r2.cloudflarestorage.com", request.host());
        assertEquals("/pictures/layu/images/" + NAME, request.encodedPath());
        assertEquals(SdkHttpMethod.PUT, request.method());
        assertTrue(request.firstMatchingHeader("Authorization").orElseThrow().contains("/auto/s3/aws4_request"));
        assertTrue(request.firstMatchingHeader("Authorization").orElseThrow().startsWith("AWS4-HMAC-SHA256 "));
        assertTrue(request.firstMatchingHeader("x-amz-checksum-crc32").isEmpty());
        assertTrue(request.firstMatchingHeader("x-amz-sdk-checksum-algorithm").isEmpty());
        assertTrue(request.firstMatchingHeader("Content-Encoding").isEmpty());
        assertArrayEquals(new byte[]{1, 2, 3}, captured.get().contentStreamProvider().orElseThrow().newStream().readAllBytes());
        assertFalse(BUCKET.toString().contains("secret"));
        assertThrows(ApiException.class, () -> client.delete(BUCKET, "../wrong.png"));
    }

    @Test void missingKeyIs404ButMissingBucketIsFailure() {
        SdkHttpClient transport = mock(SdkHttpClient.class);
        when(transport.prepareRequest(any())).thenReturn(response(404, "<Error><Code>NoSuchKey</Code></Error>"));
        R2Client client = new R2Client(transport, mock(HttpClient.class));
        assertEquals(404, assertThrows(ApiException.class, () -> client.read(BUCKET, NAME)).status());
        assertDoesNotThrow(() -> client.delete(BUCKET, NAME));
        when(transport.prepareRequest(any())).thenReturn(response(404, "<Error><Code>NoSuchBucket</Code><Message>private</Message></Error>"));
        ApiException failure = assertThrows(ApiException.class, () -> client.delete(BUCKET, NAME));
        assertNotEquals(404, failure.status());
        assertFalse(failure.toString().contains("private"));
    }

    @Test void classifiesKnownStorageFailuresWithoutLeakingCloudText() {
        SdkHttpClient transport = mock(SdkHttpClient.class);
        R2Client client = new R2Client(transport, mock(HttpClient.class));
        when(transport.prepareRequest(any())).thenReturn(response(403, "<Error><Code>AccessDenied</Code><Message>private</Message></Error>"));
        ApiException forbidden = assertThrows(ApiException.class, () -> client.put(BUCKET, NAME, "image/png", new byte[]{1}));
        assertEquals("AUTH", forbidden.code());
        assertFalse(forbidden.toString().contains("private"));
        when(transport.prepareRequest(any())).thenReturn(response(429, "<Error><Code>SlowDown</Code></Error>"));
        assertEquals("RATE_LIMIT", assertThrows(ApiException.class, () -> client.delete(BUCKET, NAME)).code());
        when(transport.prepareRequest(any())).thenReturn(new ExecutableHttpRequest() {
            public HttpExecuteResponse call() throws java.io.IOException { throw new java.io.IOException("private"); }
            public void abort() { }
        });
        ApiException network = assertThrows(ApiException.class, () -> client.read(BUCKET, NAME));
        assertEquals("NETWORK", network.code());
        assertFalse(network.toString().contains("private"));
    }

    @Test void enforcesReadLimitEvenWithoutContentLength() {
        SdkHttpClient transport = mock(SdkHttpClient.class);
        when(transport.prepareRequest(any())).thenReturn(new ExecutableHttpRequest() {
            public HttpExecuteResponse call() {
                return HttpExecuteResponse.builder().response(SdkHttpResponse.builder().statusCode(200).build())
                        .responseBody(AbortableInputStream.create(new ByteArrayInputStream(new byte[25 * 1024 * 1024 + 1]))).build();
            }
            public void abort() { }
        });
        ApiException failure = assertThrows(ApiException.class, () -> new R2Client(transport, mock(HttpClient.class)).read(BUCKET, NAME));
        assertEquals("STORAGE", failure.code());
        verify(transport).prepareRequest(any());
    }

    @Test void parsesOfficialAnalyticsAndUsesRestrictedBucketPrefix() throws Exception {
        var request = new AtomicReference<HttpRequest>();
        HttpClient http = analytics(200, """
                {"data":{"viewer":{"accounts":[{"r2StorageAdaptiveGroups":[{"max":{"payloadSize":20,"metadataSize":3,"objectCount":2},"dimensions":{"datetime":"2026-01-01T00:00:00Z"}}]}]}}}
                """, request);
        R2Client.Usage usage = new R2Client(mock(SdkHttpClient.class), http).usage(BUCKET);
        assertEquals(new R2Client.Usage("available", 20L, 3L, 2L, Instant.parse("2026-01-01T00:00:00Z")), usage);
        assertEquals("https://api.cloudflare.com/client/v4/graphql", request.get().uri().toString());
        assertEquals("Bearer analytics-secret", request.get().headers().firstValue("Authorization").orElseThrow());
        var published = new java.io.ByteArrayOutputStream();
        request.get().bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>() {
            public void onSubscribe(Flow.Subscription s) { s.request(Long.MAX_VALUE); }
            public void onNext(ByteBuffer b) { byte[] bytes = new byte[b.remaining()]; b.get(bytes); published.writeBytes(bytes); }
            public void onError(Throwable t) { fail(t); }
            public void onComplete() { }
        });
        var body = new ObjectMapper().readTree(published.toByteArray());
        assertEquals("eu_pictures", body.path("variables").path("bucketName").asText());
        assertEquals(ACCOUNT, body.path("variables").path("accountTag").asText());
        assertTrue(body.path("query").asText().contains("limit: 1"));
        assertEquals(java.time.Duration.ofSeconds(10), request.get().timeout().orElseThrow());
        Instant start = Instant.parse(body.path("variables").path("startDate").asText());
        Instant end = Instant.parse(body.path("variables").path("endDate").asText());
        assertEquals(0, end.getNano());
        assertEquals(java.time.Duration.ofDays(31), java.time.Duration.between(start, end));
    }

    @Test void closesOwnedTransports() {
        SdkHttpClient sdk = mock(SdkHttpClient.class);
        HttpClient analytics = mock(HttpClient.class);
        new R2Client(sdk, analytics).close();
        verify(sdk).close();
        verify(analytics).close();
    }

    @Test void analyticsFailuresNeverReturnCloudTextOrInventZero() {
        assertEquals("not_configured", new R2Client(mock(SdkHttpClient.class), mock(HttpClient.class)).usage(
                new R2Bucket("id", ACCOUNT, "pictures", "default", "key", "secret", "")).status());
        assertEquals("forbidden", usage(403, "secret").status());
        assertEquals("forbidden", usage(200, "{\"errors\":[{\"message\":\"not authorized secret\"}]}").status());
        assertEquals("unavailable", usage(500, "secret").status());
        assertEquals("no_data", usage(200, "{\"data\":{\"viewer\":{\"accounts\":[{\"r2StorageAdaptiveGroups\":[]}]}}}").status());
        R2Client.Usage incomplete = usage(200, "{\"data\":{\"viewer\":{\"accounts\":[{\"r2StorageAdaptiveGroups\":[{\"max\":{\"payloadSize\":0},\"dimensions\":{\"datetime\":\"2026-01-01T00:00:00Z\"}}]}]}}}");
        assertEquals("unavailable", incomplete.status());
        assertNull(incomplete.payloadBytes());
        assertFalse(incomplete.toString().contains("secret"));
    }

    private R2Client.Usage usage(int code, String body) {
        return new R2Client(mock(SdkHttpClient.class), analytics(code, body, new AtomicReference<>())).usage(BUCKET);
    }
    private static ExecutableHttpRequest response(int status, String body) {
        return new ExecutableHttpRequest() {
            public HttpExecuteResponse call() {
                return HttpExecuteResponse.builder().response(SdkHttpResponse.builder().statusCode(status).build())
                        .responseBody(AbortableInputStream.create(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)))).build();
            }
            public void abort() { }
        };
    }
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static HttpClient analytics(int status, String body, AtomicReference<HttpRequest> request) {
        HttpClient http = mock(HttpClient.class);
        when(http.sendAsync(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenAnswer(invocation -> {
            request.set(invocation.getArgument(0));
            HttpResponse.BodyHandler<byte[]> handler = invocation.getArgument(1);
            HttpResponse.ResponseInfo info = mock(HttpResponse.ResponseInfo.class);
            when(info.statusCode()).thenReturn(status);
            HttpResponse.BodySubscriber<byte[]> subscriber = handler.apply(info);
            subscriber.onSubscribe(new Flow.Subscription() { public void request(long n) { } public void cancel() { } });
            subscriber.onNext(List.of(ByteBuffer.wrap(body.getBytes(StandardCharsets.UTF_8))));
            subscriber.onComplete();
            HttpResponse<byte[]> response = mock(HttpResponse.class);
            when(response.statusCode()).thenReturn(status);
            when(response.body()).thenReturn(subscriber.getBody().toCompletableFuture().join());
            return CompletableFuture.completedFuture(response);
        });
        return http;
    }
}
