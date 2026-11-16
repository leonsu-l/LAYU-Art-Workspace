package studio.api.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import java.util.Map;

@RestControllerAdvice
public class ApiErrors {
    private static final Logger log = LoggerFactory.getLogger(ApiErrors.class);
    public static Map<String, Object> error(ApiException e) {
        return Map.of("code", e.code(), "message", e.getMessage(), "retryable", e.retryable(), "status", e.status());
    }
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<?> known(ApiException e) { return ResponseEntity.status(e.status()).body(Map.of("error", error(e))); }
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<?> malformed(HttpMessageNotReadableException e) {
        Throwable cause = e;
        while (cause != null) {
            if (cause instanceof ApiException api) return known(api);
            cause = cause.getCause();
        }
        return known(ApiException.validation("请求体不是有效的 JSON 或超过字段长度限制。"));
    }
    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> unexpected(Exception e) {
        // Database exceptions can embed SQL parameter values. Do not log exception messages or stacks here.
        log.error("Request failed ({})", e.getClass().getSimpleName());
        return known(new ApiException("UNKNOWN", "后端处理失败，请检查服务与存储状态。", 500, true));
    }
}
