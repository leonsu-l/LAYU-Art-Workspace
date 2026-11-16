package studio.api.common;

import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.Map;

@Component
@Order(10)
public class HttpLimits extends OncePerRequestFilter {
    private final ObjectMapper mapper;
    public HttpLimits(ObjectMapper mapper) { this.mapper = mapper; }
    @Bean
    static Jackson2ObjectMapperBuilderCustomizer jsonLimits() {
        return builder -> builder.postConfigurer(mapper -> mapper.getFactory().setStreamReadConstraints(
                StreamReadConstraints.builder().maxStringLength(44 * 1024 * 1024).maxNestingDepth(32).build()));
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        response.setHeader("Cache-Control", "no-store");
        if (!request.getRequestURI().startsWith("/api/")) { chain.doFilter(request, response); return; }
        try {
            if ("cross-site".equals(request.getHeader("Sec-Fetch-Site"))) throw new ApiException("AUTH", "不允许跨站调用。", 403, false);
            long limit = request.getRequestURI().equals("/api/tasks") ? 44L * 1024 * 1024 : 64L * 1024;
            if (request.getContentLengthLong() > limit) throw tooLarge();
            chain.doFilter(new HttpServletRequestWrapper(request) {
                private ServletInputStream limited;
                @Override public ServletInputStream getInputStream() throws IOException {
                    if (limited != null) return limited;
                    ServletInputStream source = super.getInputStream();
                    limited = new ServletInputStream() {
                        long received;
                        private void count(int length) { if (length > 0 && (received += length) > limit) throw tooLarge(); }
                        @Override public int read() throws IOException { int value = source.read(); if (value >= 0) count(1); return value; }
                        @Override public int read(byte[] bytes, int start, int length) throws IOException { int value = source.read(bytes, start, length); count(value); return value; }
                        @Override public boolean isFinished() { return source.isFinished(); }
                        @Override public boolean isReady() { return source.isReady(); }
                        @Override public void setReadListener(ReadListener listener) { source.setReadListener(listener); }
                    };
                    return limited;
                }
            }, response);
        } catch (ApiException e) {
            response.setStatus(e.status());
            response.setContentType("application/json;charset=UTF-8");
            mapper.writeValue(response.getOutputStream(), Map.of("error", ApiErrors.error(e)));
        }
    }
    private static ApiException tooLarge() { return new ApiException("VALIDATION", "请求体超过大小上限。", 413, false); }
}
