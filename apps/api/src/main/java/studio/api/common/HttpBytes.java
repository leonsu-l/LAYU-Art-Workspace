package studio.api.common;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Limits both total response bytes and the entire exchange, including a stalled response body. */
public final class HttpBytes {
    private HttpBytes() {}
    public static HttpResponse<byte[]> send(HttpClient client, HttpRequest request, int limit, Duration timeout) {
        var future = client.sendAsync(request, info -> new LimitedBody(limit));
        try {
            return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new ApiException("NETWORK", "上游请求被中断。", 502, true);
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new ApiException("NETWORK", "上游请求超时，未自动重试。", 502, true);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            while (cause != null) {
                if (cause instanceof ApiException api) throw api;
                cause = cause.getCause();
            }
            throw new ApiException("NETWORK", "上游网络请求失败。", 502, true);
        }
    }

    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final int limit;
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final CompletableFuture<byte[]> body = new CompletableFuture<>();
        private Flow.Subscription subscription;
        LimitedBody(int limit) { this.limit = limit; }
        @Override public CompletionStage<byte[]> getBody() { return body; }
        @Override public void onSubscribe(Flow.Subscription value) { subscription = value; subscription.request(1); }
        @Override public void onNext(List<ByteBuffer> buffers) {
            for (ByteBuffer buffer : buffers) {
                if ((long) bytes.size() + buffer.remaining() > limit) {
                    subscription.cancel();
                    body.completeExceptionally(new ApiException("BAD_RESPONSE", "上游响应超过大小限制。", 502, false));
                    return;
                }
                byte[] chunk = new byte[buffer.remaining()];
                buffer.get(chunk);
                bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }
        @Override public void onError(Throwable failure) { body.completeExceptionally(failure); }
        @Override public void onComplete() { body.complete(bytes.toByteArray()); }
    }
}
