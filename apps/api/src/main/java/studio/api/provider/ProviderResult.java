package studio.api.provider;

import java.util.List;

public record ProviderResult(String provider, String model, String text, List<GeneratedImage> images, String createdAt) {}
