use crate::ai::{
    error::{connection_error, http_error, Diagnostic},
    types::{ChatMessage, ImageInput, ModelInfo, ProviderConfig, ProviderId, ReasoningEffort},
};
use reqwest::{Client, RequestBuilder};
use serde_json::{json, Value};
use url::Url;

mod anthropic;
mod gemini;
mod lm_studio;
mod nvidia;
mod ollama;
mod openai;
mod zai;

pub struct StreamChunk {
    pub text: Option<String>,
    pub reasoning: Option<String>,
    pub done: bool,
    pub error: Option<String>,
}

pub fn endpoint(config: &ProviderConfig, suffix: &str) -> Result<Url, Diagnostic> {
    let mut base = config.endpoint.trim().trim_end_matches('/').to_string();
    if config.provider == ProviderId::LmStudio
        && suffix.starts_with("/api/")
        && base.ends_with("/v1")
    {
        base.truncate(base.len() - 3);
    }
    let parsed = Url::parse(&base).map_err(|_| invalid_endpoint(&config.endpoint))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(invalid_endpoint(&config.endpoint));
    }
    Url::parse(&format!("{}{}", base, suffix)).map_err(|_| invalid_endpoint(&config.endpoint))
}

fn invalid_endpoint(value: &str) -> Diagnostic {
    Diagnostic::new(
        "INVALID_ENDPOINT",
        "Endpoint incorrecto",
        format!("“{value}” no es una dirección HTTP válida."),
        "La URL está incompleta o utiliza un protocolo no permitido.",
        "Restaura el endpoint predeterminado o corrige la URL.",
        false,
    )
}

fn with_auth(
    builder: RequestBuilder,
    provider: ProviderId,
    key: Option<&str>,
) -> Result<RequestBuilder, Diagnostic> {
    if provider.requires_api_key() && key.is_none() {
        return Err(Diagnostic::new(
            "INVALID_API_KEY",
            "Falta la clave API",
            "Este proveedor necesita una clave antes de conectarse.",
            "No hay una clave guardada.",
            "Guarda una clave API y vuelve a probar.",
            false,
        ));
    }
    Ok(match provider {
        ProviderId::Anthropic => builder
            .header("x-api-key", key.unwrap())
            .header("anthropic-version", "2023-06-01"),
        ProviderId::Gemini => builder.header("x-goog-api-key", key.unwrap()),
        ProviderId::OpenAi | ProviderId::Zai | ProviderId::Kimi => {
            builder.bearer_auth(key.unwrap())
        }
        ProviderId::Custom => match key {
            Some(value) => builder.bearer_auth(value),
            None => builder,
        },
        ProviderId::Nvidia => builder
            .bearer_auth(key.unwrap())
            .header("Accept", "text/event-stream"),
        _ => builder,
    })
}

pub async fn list_models(
    client: &Client,
    config: &ProviderConfig,
    key: Option<&str>,
) -> Result<Vec<ModelInfo>, Diagnostic> {
    if config.provider == ProviderId::Zai {
        return Ok(zai::models());
    }
    let (url, native_lm) = match config.provider {
        ProviderId::Ollama => (endpoint(config, ollama::MODELS_PATH)?, false),
        ProviderId::LmStudio => (endpoint(config, lm_studio::MODELS_PATH)?, true),
        ProviderId::OpenAi => (endpoint(config, openai::MODELS_PATH)?, false),
        ProviderId::Anthropic => (endpoint(config, anthropic::MODELS_PATH)?, false),
        ProviderId::Gemini => (endpoint(config, gemini::MODELS_PATH)?, false),
        ProviderId::Nvidia => (endpoint(config, nvidia::MODELS_PATH)?, false),
        ProviderId::Zai => unreachable!("Z.AI uses its documented integrated catalog"),
        ProviderId::Kimi => (endpoint(config, openai::MODELS_PATH)?, false),
        ProviderId::Custom => (endpoint(config, openai::MODELS_PATH)?, false),
    };
    let request = with_auth(client.get(url), config.provider, key)?;
    let response = request.send().await.map_err(|error| {
        connection_error(config.provider.display_name(), &config.endpoint, &error)
    })?;
    let status = response.status();
    let body = response.text().await.map_err(|_| {
        Diagnostic::new(
            "INVALID_RESPONSE",
            "Respuesta incompleta",
            "No se pudo leer la lista de modelos.",
            "El servidor cerró la respuesta antes de tiempo.",
            "Vuelve a probar la conexión.",
            true,
        )
    })?;
    if !status.is_success() {
        return Err(http_error(status, &body, config.provider.display_name()));
    }
    let value: Value = serde_json::from_str(&body).map_err(|_| {
        Diagnostic::new(
            "INVALID_RESPONSE",
            "Lista de modelos no válida",
            "El servidor respondió con un formato desconocido.",
            "El endpoint puede no ser compatible.",
            "Comprueba el endpoint configurado.",
            false,
        )
    })?;
    let items = match config.provider {
        ProviderId::Ollama => value.get("models"),
        ProviderId::Gemini => value.get("models"),
        _ => value.get("data").or_else(|| value.get("models")),
    }
    .and_then(Value::as_array)
    .cloned()
    .unwrap_or_default();
    let mut models: Vec<ModelInfo> = items
        .into_iter()
        .filter_map(|item| {
            if config.provider == ProviderId::LmStudio
                && item
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| kind != "llm")
            {
                return None;
            }
            let raw = item
                .get("id")
                .or_else(|| item.get("model"))
                .or_else(|| item.get("key"))
                .or_else(|| item.get("name"))?
                .as_str()?;
            let id = if config.provider == ProviderId::Gemini {
                raw.trim_start_matches("models/").to_string()
            } else {
                raw.to_string()
            };
            if config.provider == ProviderId::Gemini {
                let methods = item
                    .get("supportedGenerationMethods")
                    .and_then(Value::as_array);
                if methods.is_some_and(|list| {
                    !list.iter().any(|method| {
                        method
                            .as_str()
                            .is_some_and(|name| name.contains("generateContent"))
                    })
                }) {
                    return None;
                }
            }
            let loaded = if native_lm {
                item.get("loaded_instances")
                    .and_then(Value::as_array)
                    .map(|instances| !instances.is_empty())
                    .or_else(|| {
                        item.get("state")
                            .and_then(Value::as_str)
                            .map(|state| state == "loaded")
                    })
            } else {
                None
            };
            let lower_id = id.to_lowercase();
            let mut capabilities = vec!["chat".into()];
            if [
                "image",
                "imagen",
                "flux",
                "stable-diffusion",
                "dall-e",
                "gpt-image",
            ]
            .iter()
            .any(|needle| lower_id.contains(needle))
            {
                capabilities.push("image".into());
            }
            if ["video", "wan", "svd", "veo"]
                .iter()
                .any(|needle| lower_id.contains(needle))
            {
                capabilities.push("video".into());
            }
            Some(ModelInfo {
                name: item
                    .get("displayName")
                    .or_else(|| item.get("display_name"))
                    .and_then(Value::as_str)
                    .unwrap_or(&id)
                    .to_string(),
                id,
                loaded,
                context_window: item
                    .get("max_context_length")
                    .or_else(|| item.get("inputTokenLimit"))
                    .or_else(|| item.get("max_input_tokens"))
                    .and_then(Value::as_u64),
                capabilities,
            })
        })
        .collect();
    models.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    models.dedup_by(|left, right| left.id.eq_ignore_ascii_case(&right.id));
    Ok(models)
}

pub async fn test_zai_connection(
    client: &Client,
    config: &ProviderConfig,
    key: &str,
) -> Result<(), Diagnostic> {
    zai::test_connection(client, config, key, endpoint).await
}

pub fn chat_request(
    client: &Client,
    config: &ProviderConfig,
    key: Option<&str>,
    messages: &[ChatMessage],
    images: &[ImageInput],
) -> Result<RequestBuilder, Diagnostic> {
    let model = config.model.trim();
    if model.is_empty() {
        return Err(Diagnostic::new(
            "MODEL_NOT_FOUND",
            "Selecciona un modelo",
            "No hay ningún modelo seleccionado.",
            "La configuración está incompleta.",
            "Prueba la conexión y selecciona un modelo.",
            false,
        ));
    }
    let mut body = match config.provider {
        ProviderId::Ollama => ollama::body(model, messages, images),
        ProviderId::LmStudio => lm_studio::body(model, messages, images),
        ProviderId::OpenAi => openai::body(model, messages, images),
        ProviderId::Anthropic => anthropic::body(model, messages, images),
        ProviderId::Gemini => gemini::body(model, messages, images),
        ProviderId::Nvidia => nvidia::body(model, messages, images),
        ProviderId::Zai => zai::body(model, messages, images),
        ProviderId::Kimi => lm_studio::body(model, messages, images),
        ProviderId::Custom => lm_studio::body(model, messages, images),
    };
    apply_reasoning_effort(config.provider, model, config.reasoning_effort, &mut body);
    let request = match config.provider {
        ProviderId::Ollama => client
            .post(endpoint(config, ollama::CHAT_PATH)?)
            .json(&body),
        ProviderId::LmStudio => client
            .post(endpoint(config, lm_studio::CHAT_PATH)?)
            .json(&body),
        ProviderId::OpenAi => client
            .post(endpoint(config, openai::CHAT_PATH)?)
            .json(&body),
        ProviderId::Anthropic => client
            .post(endpoint(config, anthropic::CHAT_PATH)?)
            .json(&body),
        ProviderId::Gemini => client
            .post(endpoint(config, &gemini::chat_path(model))?)
            .json(&body),
        ProviderId::Nvidia => client
            .post(endpoint(config, nvidia::CHAT_PATH)?)
            .json(&body),
        ProviderId::Zai => client
            .post(endpoint(config, zai::CHAT_PATH)?)
            .header("Accept-Language", "en-US,en")
            .json(&body),
        ProviderId::Kimi => client
            .post(endpoint(config, lm_studio::CHAT_PATH)?)
            .json(&body),
        ProviderId::Custom => client
            .post(endpoint(config, lm_studio::CHAT_PATH)?)
            .json(&body),
    };
    with_auth(request, config.provider, key)
}

fn apply_reasoning_effort(
    provider: ProviderId,
    model: &str,
    effort: ReasoningEffort,
    body: &mut Value,
) {
    let model = model.to_ascii_lowercase();
    let value = effort.as_str();
    match provider {
        ProviderId::OpenAi
            if (model.starts_with('o')
                && model.chars().nth(1).is_some_and(|c| c.is_ascii_digit()))
                || model.contains("gpt-5")
                || model.contains("codex")
                || model.contains("gpt-oss") =>
        {
            // The Responses API uses a nested reasoning object.
            if !model.contains("-pro") || effort == ReasoningEffort::High {
                body["reasoning"] = json!({ "effort": value });
            }
        }
        ProviderId::Anthropic
            if [
                "opus-4-5",
                "opus-4-6",
                "opus-4-7",
                "opus-4-8",
                "opus-5",
                "sonnet-4-6",
                "sonnet-5",
                "fable-5",
                "mythos",
            ]
            .iter()
            .any(|name| model.contains(name)) =>
        {
            body["output_config"] = json!({ "effort": value });
        }
        ProviderId::Gemini if model.contains("gemini-2.5") => {
            let budget = match effort {
                ReasoningEffort::Low => 1024,
                ReasoningEffort::Medium => 8192,
                ReasoningEffort::High => 24576,
            };
            body["generationConfig"]["thinkingConfig"] = json!({ "thinkingBudget": budget });
        }
        ProviderId::Gemini if model.contains("gemini-3") => {
            body["generationConfig"]["thinkingConfig"] = json!({ "thinkingLevel": value });
        }
        ProviderId::Ollama | ProviderId::LmStudio if model.contains("gpt-oss") => {
            if provider == ProviderId::Ollama {
                body["think"] = Value::String(value.into());
            } else {
                body["reasoning_effort"] = Value::String(value.into());
            }
        }
        ProviderId::Nvidia if model.contains("gpt-oss") || model.contains("sarvam-m") => {
            body["reasoning_effort"] = Value::String(value.into());
        }
        ProviderId::Kimi if model.contains("kimi-k3") => {
            // K3 supports low/high/max. Vareliox's middle level maps to high and
            // its highest level maps to Kimi's maximum documented effort.
            let kimi_effort = match effort {
                ReasoningEffort::Low => "low",
                ReasoningEffort::Medium => "high",
                ReasoningEffort::High => "max",
            };
            body["reasoning_effort"] = Value::String(kimi_effort.into());
        }
        // Z.AI and many catalogue models only expose an on/off thinking switch.
        // Omitting a three-level field is safer than sending an unsupported value.
        _ => {}
    }
}

pub fn nvidia_status_request(
    client: &Client,
    config: &ProviderConfig,
    key: Option<&str>,
    request_id: &str,
) -> Result<RequestBuilder, Diagnostic> {
    if request_id.is_empty()
        || request_id.len() > 80
        || !request_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(Diagnostic::new(
            "INVALID_RESPONSE",
            "NVIDIA devolvió una solicitud no válida",
            "No se recibió un identificador seguro para consultar el resultado pendiente.",
            "El proveedor respondió con un formato inesperado.",
            "Vuelve a intentarlo; Vareliox no continuará una solicitud incompleta.",
            true,
        ));
    }
    Ok(with_auth(
        client.get(endpoint(config, &format!("/status/{request_id}"))?),
        ProviderId::Nvidia,
        key,
    )?
    .header("Accept", "application/json"))
}

pub fn parse_stream(provider: ProviderId, data: &str) -> StreamChunk {
    if data.trim() == "[DONE]" {
        return StreamChunk {
            text: None,
            reasoning: None,
            done: true,
            error: None,
        };
    }
    let value: Value = match serde_json::from_str(data) {
        Ok(value) => value,
        Err(_) => {
            return StreamChunk {
                text: None,
                reasoning: None,
                done: false,
                error: None,
            }
        }
    };
    let error = value.get("error").and_then(|item| {
        item.as_str().map(str::to_string).or_else(|| {
            item.get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
    });
    let (text, done) = match provider {
        ProviderId::Ollama => ollama::parse(&value),
        ProviderId::LmStudio => lm_studio::parse(&value),
        ProviderId::OpenAi => openai::parse(&value),
        ProviderId::Anthropic => anthropic::parse(&value),
        ProviderId::Gemini => gemini::parse(&value),
        ProviderId::Nvidia => nvidia::parse(&value),
        ProviderId::Zai => zai::parse(&value),
        ProviderId::Kimi => lm_studio::parse(&value),
        ProviderId::Custom => lm_studio::parse(&value),
    };
    let event = value
        .get("type")
        .or_else(|| value.get("event_type"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let reasoning = match provider {
        ProviderId::Ollama => value.pointer("/message/thinking").and_then(Value::as_str),
        ProviderId::LmStudio
        | ProviderId::Nvidia
        | ProviderId::Zai
        | ProviderId::Kimi
        | ProviderId::Custom => value
            .pointer("/choices/0/delta/reasoning")
            .or_else(|| value.pointer("/choices/0/delta/reasoning_content"))
            .and_then(Value::as_str),
        ProviderId::OpenAi
            if matches!(
                event,
                "response.reasoning_text.delta" | "response.reasoning_summary_text.delta"
            ) =>
        {
            value.get("delta").and_then(Value::as_str)
        }
        ProviderId::Anthropic
            if value.pointer("/delta/type").and_then(Value::as_str) == Some("thinking_delta") =>
        {
            value.pointer("/delta/thinking").and_then(Value::as_str)
        }
        ProviderId::Gemini if matches!(event, "reasoning.delta" | "thought.delta") => value
            .pointer("/delta/text")
            .or_else(|| value.get("delta"))
            .and_then(Value::as_str),
        _ => None,
    }
    .map(str::to_string);
    StreamChunk {
        text,
        reasoning,
        done,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    async fn mock_server(status: &'static str, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 2048];
            let _ = socket.read(&mut request).await;
            let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{address}")
    }

    #[test]
    fn validates_endpoints() {
        let mut config = ProviderConfig::defaults(ProviderId::Ollama);
        assert!(endpoint(&config, "/api/tags").is_ok());
        config.endpoint = "file:///secret".into();
        assert_eq!(
            endpoint(&config, "/api/tags").unwrap_err().code,
            "INVALID_ENDPOINT"
        );
    }

    #[test]
    fn parses_all_stream_formats_and_ignores_unknown_events() {
        assert_eq!(
            parse_stream(
                ProviderId::Ollama,
                r#"{"message":{"content":"hola"},"done":false}"#
            )
            .text
            .as_deref(),
            Some("hola")
        );
        assert_eq!(
            parse_stream(
                ProviderId::OpenAi,
                r#"{"type":"response.output_text.delta","delta":"ok"}"#
            )
            .text
            .as_deref(),
            Some("ok")
        );
        assert_eq!(
            parse_stream(
                ProviderId::Anthropic,
                r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"sí"}}"#
            )
            .text
            .as_deref(),
            Some("sí")
        );
        assert_eq!(
            parse_stream(
                ProviderId::Gemini,
                r#"{"candidates":[{"content":{"parts":[{"text":"bien"}]}}]}"#
            )
            .text
            .as_deref(),
            Some("bien")
        );
        assert!(parse_stream(ProviderId::Nvidia, r#"{"future_event":true}"#)
            .text
            .is_none());
    }

    #[test]
    fn gemini_uses_the_official_generate_content_shape() {
        let messages = vec![
            ChatMessage {
                role: "system".into(),
                content: "Reglas".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "Hola".into(),
            },
            ChatMessage {
                role: "assistant".into(),
                content: "Hola".into(),
            },
        ];
        let body = gemini::body("gemini-test", &messages, &[]);
        assert_eq!(
            body.pointer("/systemInstruction/parts/0/text")
                .and_then(Value::as_str),
            Some("Reglas")
        );
        assert_eq!(
            body.pointer("/contents/0/role").and_then(Value::as_str),
            Some("user")
        );
        assert_eq!(
            body.pointer("/contents/1/role").and_then(Value::as_str),
            Some("model")
        );
        assert_eq!(
            gemini::chat_path("models/gemini-test"),
            "/models/gemini-test:streamGenerateContent?alt=sse"
        );
    }

    #[test]
    fn builds_the_official_chat_endpoint_for_every_provider() {
        let http = Client::new();
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: "Hola".into(),
        }];
        let cases = [
            (ProviderId::Ollama, "http://127.0.0.1:11434/api/chat"),
            (ProviderId::LmStudio, "http://127.0.0.1:1234/v1/chat/completions"),
            (ProviderId::OpenAi, "https://api.openai.com/v1/responses"),
            (ProviderId::Anthropic, "https://api.anthropic.com/v1/messages"),
            (ProviderId::Gemini, "https://generativelanguage.googleapis.com/v1beta/models/test-model:streamGenerateContent?alt=sse"),
            (ProviderId::Nvidia, "https://integrate.api.nvidia.com/v1/chat/completions"),
            (ProviderId::Zai, "https://api.z.ai/api/paas/v4/chat/completions"),
            (ProviderId::Kimi, "https://api.moonshot.ai/v1/chat/completions"),
            (ProviderId::Custom, "http://127.0.0.1:8000/v1/chat/completions"),
        ];
        for (provider, expected) in cases {
            let mut config = ProviderConfig::defaults(provider);
            config.model = "test-model".into();
            let key = provider.requires_api_key().then_some("test-key");
            let request = chat_request(&http, &config, key, &messages, &[])
                .unwrap()
                .build()
                .unwrap();
            assert_eq!(request.url().as_str(), expected);
        }
    }

    #[test]
    fn provider_requests_keep_the_required_auth_and_streaming_payloads() {
        let http = Client::new();
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: "Comprueba la conexión".into(),
        }];
        for provider in [
            ProviderId::Ollama,
            ProviderId::LmStudio,
            ProviderId::OpenAi,
            ProviderId::Anthropic,
            ProviderId::Gemini,
            ProviderId::Nvidia,
            ProviderId::Zai,
            ProviderId::Kimi,
            ProviderId::Custom,
        ] {
            let mut config = ProviderConfig::defaults(provider);
            config.model = "test-model".into();
            let key = provider
                .supports_api_key()
                .then_some("test-key-never-logged");
            let request = chat_request(&http, &config, key, &messages, &[])
                .unwrap()
                .build()
                .unwrap();
            let body: Value =
                serde_json::from_slice(request.body().and_then(|body| body.as_bytes()).unwrap())
                    .unwrap();
            match provider {
                ProviderId::Gemini => {
                    assert!(request.url().path().ends_with(":streamGenerateContent"));
                    assert!(request
                        .url()
                        .query()
                        .is_some_and(|query| query.contains("alt=sse")));
                    assert_eq!(
                        request.headers().get("x-goog-api-key").unwrap(),
                        "test-key-never-logged"
                    );
                }
                ProviderId::Anthropic => {
                    assert_eq!(body.get("stream").and_then(Value::as_bool), Some(true));
                    assert_eq!(
                        request.headers().get("x-api-key").unwrap(),
                        "test-key-never-logged"
                    );
                    assert!(request.headers().contains_key("anthropic-version"));
                    assert_eq!(body.get("max_tokens").and_then(Value::as_u64), Some(4096));
                }
                ProviderId::OpenAi
                | ProviderId::Nvidia
                | ProviderId::Zai
                | ProviderId::Kimi
                | ProviderId::Custom => {
                    assert_eq!(body.get("stream").and_then(Value::as_bool), Some(true));
                    assert_eq!(
                        request.headers().get("authorization").unwrap(),
                        "Bearer test-key-never-logged"
                    );
                }
                ProviderId::Ollama | ProviderId::LmStudio => {
                    assert_eq!(body.get("stream").and_then(Value::as_bool), Some(true));
                    assert!(request.headers().get("authorization").is_none())
                }
            }
        }
    }

    #[test]
    fn separates_reasoning_from_the_final_answer() {
        assert_eq!(
            parse_stream(
                ProviderId::Ollama,
                r#"{"message":{"thinking":"analizando","content":""},"done":false}"#
            )
            .reasoning
            .as_deref(),
            Some("analizando")
        );
        assert_eq!(
            parse_stream(
                ProviderId::LmStudio,
                r#"{"choices":[{"delta":{"reasoning":"paso"}}]}"#
            )
            .reasoning
            .as_deref(),
            Some("paso")
        );
        assert_eq!(parse_stream(ProviderId::Anthropic, r#"{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"revisando"}}"#).reasoning.as_deref(), Some("revisando"));
        assert_eq!(
            parse_stream(
                ProviderId::OpenAi,
                r#"{"type":"response.reasoning_text.delta","delta":"evaluando"}"#
            )
            .reasoning
            .as_deref(),
            Some("evaluando")
        );
    }

    #[tokio::test]
    async fn integration_lists_models_from_a_simulated_ollama_server() {
        let endpoint = mock_server(
            "200 OK",
            r#"{"models":[{"name":"qwen-test:latest","model":"qwen-test:latest"}]}"#,
        )
        .await;
        let mut config = ProviderConfig::defaults(ProviderId::Ollama);
        config.endpoint = endpoint;
        let models = list_models(&Client::new(), &config, None).await.unwrap();
        assert_eq!(models[0].id, "qwen-test:latest");
    }

    #[tokio::test]
    async fn integration_reads_current_lm_studio_v1_models() {
        let endpoint = mock_server("200 OK", r#"{"models":[{"type":"llm","key":"google/gemma-test","display_name":"Gemma Test","loaded_instances":[{"id":"instance"}],"max_context_length":32768},{"type":"embedding","key":"embed-test","display_name":"Embed"}]}"#).await;
        let mut config = ProviderConfig::defaults(ProviderId::LmStudio);
        config.endpoint = format!("{endpoint}/v1");
        let models = list_models(&Client::new(), &config, None).await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "google/gemma-test");
        assert_eq!(models[0].loaded, Some(true));
        assert_eq!(models[0].context_window, Some(32768));
    }

    #[tokio::test]
    async fn integration_lists_models_for_every_cloud_provider() {
        let cases = [
            (
                ProviderId::OpenAi,
                r#"{"data":[{"id":"gpt-test"}]}"#,
                "gpt-test",
            ),
            (
                ProviderId::Anthropic,
                r#"{"data":[{"id":"claude-test","display_name":"Claude Test"}]}"#,
                "claude-test",
            ),
            (
                ProviderId::Gemini,
                r#"{"models":[{"name":"models/gemini-test","displayName":"Gemini Test","supportedGenerationMethods":["generateContent"],"inputTokenLimit":32768}]}"#,
                "gemini-test",
            ),
            (
                ProviderId::Nvidia,
                r#"{"data":[{"id":"nvidia/test-model"}]}"#,
                "nvidia/test-model",
            ),
            (
                ProviderId::Kimi,
                r#"{"data":[{"id":"kimi-k3"}]}"#,
                "kimi-k3",
            ),
            (
                ProviderId::Custom,
                r#"{"data":[{"id":"custom/test-model"}]}"#,
                "custom/test-model",
            ),
        ];
        for (provider, body, expected) in cases {
            let endpoint = mock_server("200 OK", body).await;
            let mut config = ProviderConfig::defaults(provider);
            config.endpoint = endpoint;
            let models = list_models(&Client::new(), &config, Some("test-key-never-logged"))
                .await
                .unwrap();
            assert_eq!(models.len(), 1);
            assert_eq!(models[0].id, expected);
        }
    }

    #[tokio::test]
    async fn integration_keeps_every_model_returned_by_nvidia() {
        let endpoint = mock_server("200 OK", r#"{"data":[{"id":"z-ai/glm-5.2"},{"id":"nvidia/llama-3.1-nemoguard-8b-content-safety"},{"id":"nvidia/nemotron-3-embed-1b"},{"id":"poolside/laguna-xs-2.1"},{"id":"z-ai/glm-5.2"},{"id":"01-ai/yi-large"}]}"#).await;
        let mut config = ProviderConfig::defaults(ProviderId::Nvidia);
        config.endpoint = endpoint;
        let models = list_models(&Client::new(), &config, Some("nvapi-test-never-logged"))
            .await
            .unwrap();
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "01-ai/yi-large",
                "nvidia/llama-3.1-nemoguard-8b-content-safety",
                "nvidia/nemotron-3-embed-1b",
                "poolside/laguna-xs-2.1",
                "z-ai/glm-5.2",
            ]
        );
    }

    #[tokio::test]
    async fn integration_normalizes_simulated_authentication_error() {
        let endpoint = mock_server(
            "401 Unauthorized",
            r#"{"error":{"message":"invalid api key"}}"#,
        )
        .await;
        let mut config = ProviderConfig::defaults(ProviderId::OpenAi);
        config.endpoint = endpoint;
        let error = list_models(&Client::new(), &config, Some("sk-test-never-logged"))
            .await
            .unwrap_err();
        assert_eq!(error.code, "INVALID_API_KEY");
        assert!(!error
            .technical_details
            .unwrap_or_default()
            .contains("sk-test-never-logged"));
    }

    #[test]
    fn applies_effort_using_each_providers_native_shape() {
        let mut openai_body = json!({});
        apply_reasoning_effort(
            ProviderId::OpenAi,
            "gpt-5-codex",
            ReasoningEffort::High,
            &mut openai_body,
        );
        assert_eq!(
            openai_body.pointer("/reasoning/effort"),
            Some(&json!("high"))
        );

        let mut gemini_body = json!({});
        apply_reasoning_effort(
            ProviderId::Gemini,
            "gemini-2.5-flash",
            ReasoningEffort::Medium,
            &mut gemini_body,
        );
        assert_eq!(
            gemini_body.pointer("/generationConfig/thinkingConfig/thinkingBudget"),
            Some(&json!(8192))
        );

        let mut anthropic_body = json!({});
        apply_reasoning_effort(
            ProviderId::Anthropic,
            "claude-sonnet-4-6",
            ReasoningEffort::Low,
            &mut anthropic_body,
        );
        assert_eq!(
            anthropic_body.pointer("/output_config/effort"),
            Some(&json!("low"))
        );

        let mut kimi_body = json!({});
        apply_reasoning_effort(
            ProviderId::Kimi,
            "kimi-k3",
            ReasoningEffort::High,
            &mut kimi_body,
        );
        assert_eq!(kimi_body.get("reasoning_effort"), Some(&json!("max")));
    }

    #[test]
    fn does_not_send_effort_to_incompatible_models() {
        let mut body = json!({ "model": "z-ai/glm-5.2" });
        apply_reasoning_effort(
            ProviderId::Nvidia,
            "z-ai/glm-5.2",
            ReasoningEffort::High,
            &mut body,
        );
        assert!(body.get("reasoning_effort").is_none());
    }
}
