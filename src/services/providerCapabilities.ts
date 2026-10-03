import type { MediaMode, ModelCapability, ProviderConfig } from "../types";

const normalizedEndpoint = (endpoint: string) => endpoint.trim().replace(/\/+$/, "");

export function customImageVerified(config: ProviderConfig): boolean {
  return config.provider === "custom"
    && !!config.models?.image?.trim()
    && normalizedEndpoint(config.mediaVerification?.endpoint ?? "") === normalizedEndpoint(config.endpoint)
    && config.mediaVerification?.imageModel === config.models.image.trim();
}

export function providerSupports(config: ProviderConfig, capability: ModelCapability): boolean {
  if ((capability === "image" || capability === "video") && (config.provider === "ollama" || config.provider === "lm_studio")) {
    return config.models?.[capability] === (capability === "image" ? "vareliox-sd15-q4" : "vareliox-animatediff-v3");
  }
  if (capability === "video") return config.provider === "nvidia" && !!config.models?.video;
  if (capability === "image" && config.provider === "custom") return customImageVerified(config);
  return config.capabilities?.includes(capability) ?? capability === "chat";
}

export function availableMediaProviders(configs: ProviderConfig[], mode: MediaMode): ProviderConfig[] {
  return configs.filter((config) =>
    providerSupports(config, mode)
    && !!config.models?.[mode]?.trim()
    && (config.provider === "custom" || config.provider === "ollama" || config.provider === "lm_studio" || config.apiKeyConfigured),
  );
}

export function selectMediaProvider(configs: ProviderConfig[], mode: MediaMode, activeConfigId?: string | null, requestedConfigId?: string): ProviderConfig | undefined {
  const ready = availableMediaProviders(configs, mode);
  // An explicit selection must never silently generate with another provider.
  if (requestedConfigId) return ready.find((config) => config.configId === requestedConfigId);
  return ready.find((config) => config.configId === activeConfigId) ?? ready[0];
}
