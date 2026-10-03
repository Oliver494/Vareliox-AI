use crate::ai::{
    error::Diagnostic,
    types::{ChatMessage, ImageInput, ModelInfo, ProviderConfig, ProviderId},
};
use reqwest::Client;
use serde_json::{json, Value};

pub const CHAT_PATH: &str = "/chat/completions";

pub fn models() -> Vec<ModelInfo> {
    [
        ("glm-5.1", "GLM-5.1"),
        ("glm-5-turbo", "GLM-5 Turbo"),
        ("glm-5", "GLM-5"),
        ("glm-4.7", "GLM-4.7"),
        ("glm-4.7-flash", "GLM-4.7 Flash"),
        ("glm-4.7-flashx", "GLM-4.7 FlashX"),
        ("glm-4.6", "GLM-4.6"),
        ("glm-4.5", "GLM-4.5"),
        ("glm-4.5-air", "GLM-4.5 Air"),
        ("glm-4.5-flash", "GLM-4.5 Flash"),
        ("glm-4-32b-0414-128k", "GLM-4 32B 128K"),
    ]
    .into_iter()
    .map(|(id, name)| ModelInfo {
        id: id.into(),
        name: name.into(),
        loaded: None,
        context_window: None,
        capabilities: vec!["chat".into()],
    })
    .collect()
}

pub fn body(model: &str, messages: &[ChatMessage], images: &[ImageInput]) -> Value {
    let mut payload = serde_json::to_value(messages).unwrap_or_else(|_| json!([]));
    if !images.is_empty() {
        if let Some(last) = payload
            .as_array_mut()
            .and_then(|items| items.iter_mut().rev().find(|item| item["role"] == "user"))
        {
            let text = last["content"].as_str().unwrap_or_default().to_string();
            let mut parts = Vec::new();
            if !text.trim().is_empty() {
                parts.push(json!({"type":"text","text":text}));
            }
            parts.extend(images.iter().map(|image| json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}", image.mime_type, image.base64)}})));
            last["content"] = Value::Array(parts);
        }
    }
    json!({ "model": model, "messages": payload, "max_tokens": 4096, "stream": true })
}

pub async fn test_connection(
    client: &Client,
    config: &ProviderConfig,
    key: &str,
    endpoint: impl Fn(&ProviderConfig, &str) -> Result<url::Url, Diagnostic>,
) -> Result<(), Diagnostic> {
    let model = if config.model.trim().is_empty() {
        "glm-4.7-flash"
    } else {
        config.model.trim()
    };
    let response = client.post(endpoint(config, CHAT_PATH)?)
        .bearer_auth(key)
        .header("Accept-Language", "en-US,en")
        .json(&json!({"model":model,"messages":[{"role":"user","content":"ping"}],"max_tokens":1,"stream":false}))
        .send().await
        .map_err(|error| crate::ai::error::connection_error(ProviderId::Zai.display_name(), &config.endpoint, &error))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(crate::ai::error::http_error(
            status,
            &body,
            ProviderId::Zai.display_name(),
        ));
    }
    Ok(())
}

pub fn parse(value: &Value) -> (Option<String>, bool) {
    (
        value
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
            .map(str::to_string),
        false,
    )
}
