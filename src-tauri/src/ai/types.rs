use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    Ollama,
    LmStudio,
    OpenAi,
    Anthropic,
    Gemini,
    Nvidia,
    Zai,
    Kimi,
    Custom,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    Low,
    #[default]
    Medium,
    High,
}

impl ReasoningEffort {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ollama => "ollama",
            Self::LmStudio => "lm_studio",
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
            Self::Nvidia => "nvidia",
            Self::Zai => "zai",
            Self::Kimi => "kimi",
            Self::Custom => "custom",
        }
    }

    pub fn is_local(self) -> bool {
        matches!(self, Self::Ollama | Self::LmStudio)
    }

    pub fn requires_api_key(self) -> bool {
        !self.is_local() && self != Self::Custom
    }

    pub fn supports_api_key(self) -> bool {
        !self.is_local()
    }

    pub fn default_endpoint(self) -> &'static str {
        match self {
            Self::Ollama => "http://127.0.0.1:11434",
            Self::LmStudio => "http://127.0.0.1:1234/v1",
            Self::OpenAi => "https://api.openai.com/v1",
            Self::Anthropic => "https://api.anthropic.com/v1",
            Self::Gemini => "https://generativelanguage.googleapis.com/v1beta",
            Self::Nvidia => "https://integrate.api.nvidia.com/v1",
            Self::Zai => "https://api.z.ai/api/paas/v4",
            Self::Kimi => "https://api.moonshot.ai/v1",
            Self::Custom => "http://127.0.0.1:8000/v1",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Ollama => "Ollama",
            Self::LmStudio => "LM Studio",
            Self::OpenAi => "OpenAI",
            Self::Anthropic => "Anthropic",
            Self::Gemini => "Google Gemini",
            Self::Nvidia => "NVIDIA API",
            Self::Zai => "Z.AI",
            Self::Kimi => "Kimi",
            Self::Custom => "Proveedor personalizado",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    #[serde(default)]
    pub config_id: String,
    pub provider: ProviderId,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub logo_data_url: Option<String>,
    pub endpoint: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub models: ProviderModels,
    #[serde(default = "default_provider_capabilities")]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub media_verification: Option<MediaVerification>,
    #[serde(default)]
    pub reasoning_effort: ReasoningEffort,
    pub connect_timeout_secs: u64,
    pub first_response_timeout_secs: u64,
    pub inactivity_timeout_secs: u64,
    pub max_response_timeout_secs: u64,
    #[serde(default)]
    pub api_key_configured: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModels {
    #[serde(default)]
    pub chat: String,
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub video: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaVerification {
    pub endpoint: String,
    pub image_model: String,
}

fn default_provider_capabilities() -> Vec<String> {
    vec!["chat".into()]
}

impl ProviderConfig {
    pub fn defaults(provider: ProviderId) -> Self {
        let mut models = ProviderModels::default();
        let mut capabilities = default_provider_capabilities();
        match provider {
            ProviderId::Nvidia => {
                models.image = "black-forest-labs/flux.1-schnell".into();
                models.video = "stabilityai/stable-video-diffusion".into();
                capabilities.extend(["image".into(), "video".into()]);
            }
            ProviderId::OpenAi => {
                models.image = "gpt-image-1".into();
                capabilities.push("image".into());
            }
            ProviderId::Gemini => {
                models.image = "gemini-3.1-flash-image".into();
                capabilities.push("image".into());
            }
            _ => {}
        }
        Self {
            config_id: provider.as_str().to_string(),
            provider,
            display_name: provider.display_name().to_string(),
            logo_data_url: None,
            endpoint: provider.default_endpoint().to_string(),
            model: String::new(),
            models,
            capabilities,
            media_verification: None,
            reasoning_effort: ReasoningEffort::Medium,
            connect_timeout_secs: 5,
            // Los modelos locales pueden necesitar cargar pesos; las APIs externas pueden
            // tardar al procesar un contexto de proyecto antes de abrir el stream.
            // Sigue existiendo un límite finito para no dejar la interfaz esperando.
            first_response_timeout_secs: if provider.is_local() { 180 } else { 90 },
            inactivity_timeout_secs: 30,
            max_response_timeout_secs: 600,
            api_key_configured: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub active_provider: Option<ProviderId>,
    #[serde(default)]
    pub active_config_id: Option<String>,
    pub providers: Vec<ProviderConfig>,
}

impl Default for AiSettings {
    fn default() -> Self {
        let providers = [
            ProviderId::Ollama,
            ProviderId::LmStudio,
            ProviderId::OpenAi,
            ProviderId::Anthropic,
            ProviderId::Gemini,
            ProviderId::Nvidia,
            ProviderId::Zai,
            ProviderId::Kimi,
        ]
        .into_iter()
        .map(ProviderConfig::defaults)
        .collect();
        Self {
            active_provider: None,
            active_config_id: None,
            providers,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub loaded: Option<bool>,
    pub context_window: Option<u64>,
    #[serde(default = "default_provider_capabilities")]
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelCatalogItem {
    pub id: String,
    pub name: String,
    pub family: String,
    pub description: String,
    pub parameters: String,
    pub size: String,
    pub ollama_id: String,
    pub lm_studio_id: String,
    pub recommended: bool,
    pub category: String,
    pub capabilities: Vec<String>,
    pub runtimes: Vec<String>,
    pub guide_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum LocalModelDownloadEvent {
    Status {
        message: String,
        progress: Option<u8>,
    },
    Done {
        model_id: String,
    },
    Error {
        diagnostic: super::error::Diagnostic,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedAttachment {
    pub name: String,
    pub mime_type: String,
    pub kind: String,
    pub data: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFolderGrant {
    pub id: String,
    pub path: String,
    pub name: String,
    pub access: String,
}

#[derive(Clone, Debug)]
pub struct ImageInput {
    pub mime_type: String,
    pub base64: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: String,
    pub project_path: Option<String>,
    pub config: ProviderConfig,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub uploads: Vec<UploadedAttachment>,
    #[serde(default)]
    pub external_folders: Vec<ExternalFolderGrant>,
    #[serde(default)]
    pub workspace_access: bool,
    #[serde(default)]
    pub can_edit: bool,
    #[serde(default)]
    pub code_mode: bool,
    #[serde(default)]
    pub terminal_access: String,
    #[serde(default)]
    pub terminal_shell: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum ChatEvent {
    Status {
        message: String,
        elapsed_ms: u64,
    },
    Reasoning {
        text: String,
    },
    Delta {
        text: String,
    },
    Done {
        elapsed_ms: u64,
    },
    Error {
        diagnostic: super::error::Diagnostic,
    },
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub connected: bool,
    pub duration_ms: u64,
    pub models: Vec<ModelInfo>,
    pub diagnostic: Option<super::error::Diagnostic>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaGenerationRequest {
    pub request_id: String,
    pub config: ProviderConfig,
    pub mode: String,
    pub model: String,
    pub prompt: String,
    pub image_data: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaGenerationResult {
    pub id: String,
    pub media_type: String,
    pub data_url: String,
    pub uri: Option<String>,
    pub mime_type: String,
    pub provider: ProviderId,
    pub model: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
    pub seed: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchRequest {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchSource {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResult {
    pub query: String,
    pub sources: Vec<WebSearchSource>,
}
