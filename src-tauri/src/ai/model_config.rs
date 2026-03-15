//! Model capability detection for adaptive behavior
//!
//! Different AI models have varying support for JSON mode, tool calling,
//! and output token limits. This module provides detection functions
//! to enable graceful adaptation.

/// Whether a provider+model combination supports JSON mode (structured output)
pub fn supports_json_mode(provider: &str, model: &str) -> bool {
    match provider {
        "openai" => true, // All OpenAI chat models support response_format
        "anthropic" => false, // Anthropic doesn't have a JSON mode flag
        "google" => true, // Gemini supports responseMimeType
        "openrouter" => {
            // OpenRouter passes through — depends on underlying model
            let model_lower = model.to_lowercase();
            model_lower.contains("openai/")
                || model_lower.contains("google/")
                || model_lower.contains("anthropic/") // Anthropic via OR still doesn't support it
                    && false
                || model_lower.contains("deepseek/")
        }
        "ollama" | "lmstudio" => false, // Not reliably supported
        "openai-compatible" => false, // Can't assume support
        _ => false,
    }
}

/// Whether a provider+model combination supports native tool calling
#[allow(dead_code)]
pub fn supports_tool_calling(provider: &str, model: &str) -> bool {
    match provider {
        "openai" => true,
        "anthropic" => true,
        "google" => true,
        "openrouter" => {
            let model_lower = model.to_lowercase();
            // Most major models on OpenRouter support tools
            model_lower.contains("openai/")
                || model_lower.contains("anthropic/")
                || model_lower.contains("google/")
                || model_lower.contains("deepseek/")
                || model_lower.contains("mistral")
        }
        "ollama" => {
            let model_lower = model.to_lowercase();
            // Some Ollama models support tools
            model_lower.contains("llama3")
                || model_lower.contains("mistral")
                || model_lower.contains("qwen")
        }
        "lmstudio" | "openai-compatible" => {
            // Can't reliably determine — assume yes if tools are configured
            true
        }
        _ => false,
    }
}

/// Recommended max output tokens for a provider+model combination
pub fn recommended_max_tokens(provider: &str, model: &str) -> u32 {
    match provider {
        "anthropic" => {
            let model_lower = model.to_lowercase();
            if model_lower.contains("opus-4") || model_lower.contains("sonnet-4") {
                16384
            } else if model_lower.contains("claude-3-5") || model_lower.contains("claude-3-7") {
                8192
            } else {
                8192
            }
        }
        "openai" => {
            let model_lower = model.to_lowercase();
            if model_lower.starts_with("o1") || model_lower.starts_with("o3") {
                16384
            } else if model_lower.contains("gpt-4o") {
                16384
            } else {
                4096
            }
        }
        "google" => {
            8192 // Gemini models generally support large outputs
        }
        _ => 4096, // Safe default
    }
}

/// Detect if a model is a "small" or weaker model that needs simpler prompts
pub fn is_small_model(model: &str) -> bool {
    let model_lower = model.to_lowercase();

    // Known small/weak models
    model_lower.contains("llama-3.1-8b")
        || model_lower.contains("llama-3.2")
        || model_lower.contains("mistral-7b")
        || model_lower.contains("phi-3")
        || model_lower.contains("phi-4")
        || model_lower.contains("gemma-2")
        || model_lower.contains("gemma2")
        || model_lower.contains("qwen2.5-7b")
        || model_lower.contains("qwen2.5-14b")
        || model_lower.contains("mini")
        || model_lower.contains("haiku")
        || model_lower.contains("flash-lite")
        || model_lower.contains("gpt-3.5")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_mode_support() {
        assert!(supports_json_mode("openai", "gpt-4o"));
        assert!(!supports_json_mode("anthropic", "claude-3-5-sonnet-20241022"));
        assert!(supports_json_mode("google", "gemini-2.0-flash"));
        assert!(!supports_json_mode("ollama", "llama3.1:8b"));
    }

    #[test]
    fn test_small_model_detection() {
        assert!(is_small_model("gpt-3.5-turbo"));
        assert!(is_small_model("claude-3-5-haiku-20241022"));
        assert!(is_small_model("llama-3.1-8b-instruct"));
        assert!(!is_small_model("gpt-4o"));
        assert!(!is_small_model("claude-3-5-sonnet-20241022"));
        assert!(!is_small_model("claude-opus-4-20250514"));
    }

    #[test]
    fn test_max_tokens() {
        assert_eq!(recommended_max_tokens("anthropic", "claude-opus-4-20250514"), 16384);
        assert_eq!(recommended_max_tokens("anthropic", "claude-3-5-sonnet-20241022"), 8192);
        assert_eq!(recommended_max_tokens("openai", "gpt-4o"), 16384);
    }
}
