package studio.api.provider;

import studio.api.task.GenerationRequest;

public interface ImageProvider {
    ProviderResult generate(GenerationRequest request);
}
