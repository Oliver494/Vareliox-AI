import assert from "node:assert/strict";
import test from "node:test";
import { availableMediaProviders, customImageVerified, providerSupports, selectMediaProvider } from "../src/services/providerCapabilities.ts";
import type { ProviderConfig } from "../src/types.ts";

const custom = (): ProviderConfig => ({
  configId: "custom:test",
  provider: "custom",
  displayName: "Test",
  logoDataUrl: null,
  endpoint: "http://127.0.0.1:8000/v1",
  model: "chat-model",
  models: { chat: "chat-model", image: "image-model", video: "" },
  capabilities: ["chat", "image"],
  reasoningEffort: "medium",
  connectTimeoutSecs: 5,
  firstResponseTimeoutSecs: 90,
  inactivityTimeoutSecs: 30,
  maxResponseTimeoutSecs: 600,
  apiKeyConfigured: false,
});

test("the picker and generation use the same provider and never override an explicit choice", () => {
  const first: ProviderConfig = { ...custom(), configId: "local", provider: "lm_studio", models: { chat: "", image: "vareliox-sd15-q4", video: "" } };
  const active: ProviderConfig = { ...custom(), configId: "cloud", provider: "gemini", apiKeyConfigured: true };
  assert.equal(selectMediaProvider([first, active], "image", "cloud")?.configId, "cloud");
  assert.equal(selectMediaProvider([first, active], "image", "cloud", "local")?.configId, "local");
  assert.equal(selectMediaProvider([first, active], "image", "cloud", "missing"), undefined);
  active.apiKeyConfigured = false;
  assert.equal(selectMediaProvider([first, active], "image", "cloud")?.configId, "local");
  assert.equal(selectMediaProvider([first, active], "image", "cloud", "cloud"), undefined);
});

test("a custom image model stays unavailable until an explicit successful test", () => {
  const config = custom();
  assert.equal(customImageVerified(config), false);
  assert.equal(providerSupports(config, "image"), false);
  config.mediaVerification = { endpoint: config.endpoint, imageModel: config.models.image };
  assert.equal(customImageVerified(config), true);
  assert.equal(providerSupports(config, "image"), true);
});

test("a changed endpoint or image model invalidates a previous verification", () => {
  const config = custom();
  config.mediaVerification = { endpoint: config.endpoint, imageModel: config.models.image };
  config.endpoint = "http://127.0.0.1:9000/v1";
  assert.equal(providerSupports(config, "image"), false);
  config.endpoint = "http://127.0.0.1:8000/v1/";
  assert.equal(providerSupports(config, "image"), true);
  config.models.image = "other-model";
  assert.equal(providerSupports(config, "image"), false);
  assert.equal(providerSupports(config, "video"), false);
});

test("media selection ignores an unconfigured cloud provider when another is ready", () => {
  const inactive = { ...custom(), provider: "open_ai" as const, configId: "open_ai", apiKeyConfigured: false };
  const ready = custom();
  ready.mediaVerification = { endpoint: ready.endpoint, imageModel: ready.models.image };
  assert.deepEqual(availableMediaProviders([inactive, ready], "image").map((item) => item.configId), ["custom:test"]);
  assert.deepEqual(availableMediaProviders([inactive, ready], "video"), []);
});

test("managed local media does not need an API key or replace the chat model", () => {
  for (const provider of ["ollama", "lm_studio"] as const) {
    const config = { ...custom(), provider, configId: provider, models: { chat: "my-chat-model", image: "vareliox-sd15-q4", video: "vareliox-animatediff-v3" } };
    assert.equal(providerSupports(config, "image"), true);
    assert.equal(providerSupports(config, "video"), true);
    assert.deepEqual(availableMediaProviders([config], "image"), [config]);
    assert.deepEqual(availableMediaProviders([config], "video"), [config]);
    assert.equal(config.models.chat, "my-chat-model");
    config.models.image = "some-ollama-chat-model";
    config.models.video = "comfyui-not-installed";
    assert.equal(providerSupports(config, "image"), false);
    assert.equal(providerSupports(config, "video"), false);
  }
});
