//! MCP transport implementations (stdio and HTTP)

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use super::{JsonRpcRequest, JsonRpcResponse};
use crate::error::{AppError, AppResult};

/// Transport trait for MCP communication
pub trait MCPTransport: Send + Sync {
    /// Send a request and receive a response
    fn send(&self, request: JsonRpcRequest) -> AppResult<JsonRpcResponse>;

    /// Close the transport
    fn close(&self) -> AppResult<()>;

    /// Check if transport is still alive
    fn is_alive(&self) -> bool;
}

/// Stdio transport - spawns a process and communicates via stdin/stdout
pub struct StdioTransport {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    stdout: Mutex<Option<BufReader<std::process::ChildStdout>>>,
    request_id: AtomicU64,
}

impl StdioTransport {
    /// Create a new stdio transport by spawning the given command
    pub fn new(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> AppResult<Self> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        // Add environment variables
        for (key, value) in env {
            cmd.env(key, value);
        }

        let mut child = cmd.spawn().map_err(|e| {
            AppError::MCP(format!("Failed to spawn MCP server '{}': {}", command, e))
        })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            AppError::MCP("Failed to get stdin for MCP server".to_string())
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::MCP("Failed to get stdout for MCP server".to_string())
        })?;

        Ok(Self {
            child: Mutex::new(Some(child)),
            stdin: Mutex::new(Some(stdin)),
            stdout: Mutex::new(Some(BufReader::new(stdout))),
            request_id: AtomicU64::new(1),
        })
    }

    fn next_id(&self) -> u64 {
        self.request_id.fetch_add(1, Ordering::SeqCst)
    }
}

impl MCPTransport for StdioTransport {
    fn send(&self, mut request: JsonRpcRequest) -> AppResult<JsonRpcResponse> {
        // Assign request ID if not set
        if request.id == 0 {
            request.id = self.next_id();
        }

        let mut stdin = self.stdin.lock().map_err(|_| {
            AppError::MCP("Failed to lock stdin".to_string())
        })?;

        let stdin = stdin.as_mut().ok_or_else(|| {
            AppError::MCP("Transport is closed".to_string())
        })?;

        // Serialize and send request
        let request_json = serde_json::to_string(&request).map_err(|e| {
            AppError::MCP(format!("Failed to serialize request: {}", e))
        })?;

        writeln!(stdin, "{}", request_json).map_err(|e| {
            AppError::MCP(format!("Failed to write to MCP server: {}", e))
        })?;

        stdin.flush().map_err(|e| {
            AppError::MCP(format!("Failed to flush to MCP server: {}", e))
        })?;

        // Read response
        let mut stdout = self.stdout.lock().map_err(|_| {
            AppError::MCP("Failed to lock stdout".to_string())
        })?;

        let stdout = stdout.as_mut().ok_or_else(|| {
            AppError::MCP("Transport is closed".to_string())
        })?;

        let mut line = String::new();
        stdout.read_line(&mut line).map_err(|e| {
            AppError::MCP(format!("Failed to read from MCP server: {}", e))
        })?;

        if line.is_empty() {
            return Err(AppError::MCP("MCP server closed connection".to_string()));
        }

        let response: JsonRpcResponse = serde_json::from_str(&line).map_err(|e| {
            AppError::MCP(format!("Failed to parse MCP response: {} (line: {})", e, line.trim()))
        })?;

        Ok(response)
    }

    fn close(&self) -> AppResult<()> {
        // Drop stdin/stdout to signal EOF
        {
            let mut stdin = self.stdin.lock().map_err(|_| {
                AppError::MCP("Failed to lock stdin".to_string())
            })?;
            *stdin = None;
        }

        {
            let mut stdout = self.stdout.lock().map_err(|_| {
                AppError::MCP("Failed to lock stdout".to_string())
            })?;
            *stdout = None;
        }

        // Kill the child process
        if let Ok(mut child_guard) = self.child.lock() {
            if let Some(ref mut child) = *child_guard {
                let _ = child.kill();
                let _ = child.wait();
            }
            *child_guard = None;
        }

        Ok(())
    }

    fn is_alive(&self) -> bool {
        if let Ok(child_guard) = self.child.lock() {
            if let Some(ref child) = *child_guard {
                // Check if process is still running
                // We can't use try_wait in a non-mut context, so just check if stdin exists
                return self.stdin.lock().map(|s| s.is_some()).unwrap_or(false);
            }
        }
        false
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

/// HTTP transport - communicates with MCP server over HTTP
pub struct HttpTransport {
    client: reqwest::blocking::Client,
    url: String,
    request_id: AtomicU64,
}

impl HttpTransport {
    pub fn new(url: &str) -> AppResult<Self> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| AppError::MCP(format!("Failed to create HTTP client: {}", e)))?;

        Ok(Self {
            client,
            url: url.to_string(),
            request_id: AtomicU64::new(1),
        })
    }

    fn next_id(&self) -> u64 {
        self.request_id.fetch_add(1, Ordering::SeqCst)
    }
}

impl MCPTransport for HttpTransport {
    fn send(&self, mut request: JsonRpcRequest) -> AppResult<JsonRpcResponse> {
        if request.id == 0 {
            request.id = self.next_id();
        }

        let response = self.client
            .post(&self.url)
            .json(&request)
            .send()
            .map_err(|e| AppError::MCP(format!("HTTP request failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(AppError::MCP(format!(
                "MCP server returned error status: {}",
                response.status()
            )));
        }

        let json_response: JsonRpcResponse = response.json().map_err(|e| {
            AppError::MCP(format!("Failed to parse MCP response: {}", e))
        })?;

        Ok(json_response)
    }

    fn close(&self) -> AppResult<()> {
        // HTTP transport doesn't need explicit cleanup
        Ok(())
    }

    fn is_alive(&self) -> bool {
        // HTTP transport is stateless, always "alive"
        true
    }
}
