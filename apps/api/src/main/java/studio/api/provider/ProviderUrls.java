package studio.api.provider;

import studio.api.common.ApiException;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;
import java.util.stream.Collectors;

/** Use the same channel root for discovery and generation, preserving custom query parameters. */
public final class ProviderUrls {
    private ProviderUrls() {}
    public static URI models(String provider, String address) {
        URI base = base(address);
        boolean gemini = provider.equals("gemini-compatible");
        return uri(base, root(base, gemini) + "/models", gemini ? withoutKey(base.getRawQuery()) : base.getRawQuery());
    }
    public static URI openAi(String address, boolean editing) {
        URI base = base(address);
        return uri(base, root(base, false) + "/images/" + (editing ? "edits" : "generations"), base.getRawQuery());
    }
    public static URI gemini(String address, String model, String key) {
        URI base = base(address);
        String id = model.startsWith("models/") ? model.substring(7) : model;
        String query = withoutKey(base.getRawQuery());
        query = (query == null || query.isEmpty() ? "" : query + "&") + "key=" + encode(key);
        return uri(base, root(base, true) + "/models/" + encode(id) + ":generateContent", query);
    }
    private static String root(URI base, boolean gemini) {
        String path = base.getRawPath().replaceAll("/+$", "");
        if (gemini) {
            path = path.replaceFirst("/models/[^/]+:generateContent$", "");
            return path.isEmpty() ? "/v1beta" : path;
        }
        if (path.matches(".*/images/(generations|edits)$")) return path.replaceFirst("/images/(generations|edits)$", "");
        return path.endsWith("/v1") ? path : path + "/v1";
    }
    private static URI base(String value) {
        try {
            URI uri = URI.create(value.trim());
            if (uri.getScheme() == null || !(uri.getScheme().equalsIgnoreCase("http") || uri.getScheme().equalsIgnoreCase("https"))
                    || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) throw new IllegalArgumentException();
            return uri;
        } catch (Exception e) { throw ApiException.validation("供应商地址必须为有效 HTTP(S) URL。"); }
    }
    private static URI uri(URI base, String rawPath, String rawQuery) {
        return URI.create(base.getScheme().toLowerCase(Locale.ROOT) + "://" + base.getRawAuthority() + rawPath
                + (rawQuery == null || rawQuery.isEmpty() ? "" : "?" + rawQuery));
    }
    private static String withoutKey(String query) {
        if (query == null) return null;
        return Arrays.stream(query.split("&")).filter(part -> !URLDecoder.decode(part.split("=", 2)[0], StandardCharsets.UTF_8).equals("key")).collect(Collectors.joining("&"));
    }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20"); }
}
