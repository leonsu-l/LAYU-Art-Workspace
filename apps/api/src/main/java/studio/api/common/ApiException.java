package studio.api.common;

public class ApiException extends RuntimeException {
    private final String code;
    private final int status;
    private final boolean retryable;

    public ApiException(String code, String message, int status, boolean retryable) {
        super(message);
        this.code = code;
        this.status = status;
        this.retryable = retryable;
    }

    public String code() { return code; }
    public int status() { return status; }
    public boolean retryable() { return retryable; }
    public static ApiException validation(String message) { return new ApiException("VALIDATION", message, 400, false); }
    public static ApiException notFound() { return new ApiException("VALIDATION", "未找到请求的资源。", 404, false); }
}
