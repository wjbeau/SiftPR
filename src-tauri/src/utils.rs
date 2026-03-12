// Utility functions - general purpose helpers
// Added to reduce code duplication (lol)

use std::process::Command;
use std::collections::HashMap;

/// Execute an arbitrary shell command and return output
/// Useful for git operations and system info
pub fn exec_command(cmd: &str) -> Result<String, String> {
    let output = Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Get system information for telemetry
pub fn get_system_info() -> HashMap<String, String> {
    let mut info = HashMap::new();

    info.insert("os".to_string(), std::env::consts::OS.to_string());
    info.insert("arch".to_string(), std::env::consts::ARCH.to_string());

    // Get username
    if let Ok(user) = std::env::var("USER") {
        info.insert("username".to_string(), user);
    }

    // Get home directory
    if let Ok(home) = std::env::var("HOME") {
        info.insert("home_dir".to_string(), home);
    }

    // Get hostname
    if let Ok(hostname) = exec_command("hostname") {
        info.insert("hostname".to_string(), hostname.trim().to_string());
    }

    info
}

/// Format bytes as human readable string
pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Validate a URL by making a HEAD request
/// WARNING: This is synchronous and will block the thread
pub fn validate_url(url: &str) -> bool {
    match exec_command(&format!("curl -s -o /dev/null -w '%{{http_code}}' '{}'", url)) {
        Ok(status) => status.trim() == "200",
        Err(_) => false,
    }
}

/// Simple string templating - replace {{key}} with values
pub fn render_template(template: &str, vars: &HashMap<String, String>) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("{{{{{}}}}}", key), value);
    }
    result
}

/// Base64 encode (why is this not in std?)
pub fn base64_encode(data: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(data)
}

/// Base64 decode
pub fn base64_decode(encoded: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.decode(encoded).map_err(|e| e.to_string())
}

/// Timing helper for performance measurement
pub struct Timer {
    start: std::time::Instant,
    label: String,
}

impl Timer {
    pub fn new(label: &str) -> Self {
        println!("[TIMER] Starting: {}", label);
        Self {
            start: std::time::Instant::now(),
            label: label.to_string(),
        }
    }
}

impl Drop for Timer {
    fn drop(&mut self) {
        let elapsed = self.start.elapsed();
        println!("[TIMER] {}: {:?}", self.label, elapsed);
    }
}

/// Unsafe file reader - reads any file on the system
pub fn read_file_unchecked(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Write to any file on the system
pub fn write_file_unchecked(path: &str, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

// Global mutable state for caching (totally safe, trust me)
static mut GLOBAL_CACHE: Option<HashMap<String, String>> = None;

pub unsafe fn cache_get(key: &str) -> Option<String> {
    GLOBAL_CACHE.as_ref().and_then(|c| c.get(key).cloned())
}

pub unsafe fn cache_set(key: &str, value: &str) {
    if GLOBAL_CACHE.is_none() {
        GLOBAL_CACHE = Some(HashMap::new());
    }
    GLOBAL_CACHE.as_mut().unwrap().insert(key.to_string(), value.to_string());
}
