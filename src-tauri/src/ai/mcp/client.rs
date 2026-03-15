//! MCP client for managing server connections and tool execution

use std::collections::HashMap;
use std::sync::RwLock;

use serde_json::json;

use super::transport::{HttpTransport, MCPTransport, StdioTransport};
use super::{
    InitializeResult, JsonRpcRequest, MCPTool, ToolCallResult, ToolsListResult,
};
use crate::ai::tools::{ToolDefinition, ToolResult, ToolSource};
use crate::db::MCPServerConfig;
use crate::error::{AppError, AppResult};

/// Connected MCP server instance
#[allow(dead_code)]
struct MCPConnection {
    config: MCPServerConfig,
    transport: Box<dyn MCPTransport>,
    tools: Vec<MCPTool>,
    initialized: bool,
}


/// Manager for MCP server connections
pub struct MCPManager {
    connections: RwLock<HashMap<String, MCPConnection>>,
}

impl MCPManager {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }

    /// Connect to an MCP server and discover its tools
    #[allow(dead_code)]
    pub fn connect(&self, config: &MCPServerConfig) -> AppResult<Vec<MCPTool>> {
        // Create transport based on type
        let transport: Box<dyn MCPTransport> = match config.transport_type.as_str() {
            "http" => {
                let url = config.http_url.as_ref().ok_or_else(|| {
                    AppError::MCP("HTTP transport requires http_url".to_string())
                })?;
                Box::new(HttpTransport::new(url)?)
            }
            "stdio" | _ => {
                Box::new(StdioTransport::new(
                    &config.server_command,
                    &config.server_args,
                    &config.server_env,
                )?)
            }
        };

        // Initialize the server
        let init_request = JsonRpcRequest::new(
            1,
            "initialize",
            Some(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "roots": { "listChanged": false }
                },
                "clientInfo": {
                    "name": "SiftPR",
                    "version": env!("CARGO_PKG_VERSION")
                }
            })),
        );

        let init_response = transport.send(init_request)?;

        if let Some(error) = init_response.error {
            return Err(AppError::MCP(format!("Initialize failed: {}", error)));
        }

        let _init_result: InitializeResult = init_response
            .result
            .ok_or_else(|| AppError::MCP("No initialize result".to_string()))
            .and_then(|r| {
                serde_json::from_value(r).map_err(|e| {
                    AppError::MCP(format!("Failed to parse initialize result: {}", e))
                })
            })?;

        // Send initialized notification (no response expected for notifications)
        // For stdio, we'll skip this as notifications are fire-and-forget
        // and could complicate the protocol flow

        // List available tools
        let tools_request = JsonRpcRequest::new(2, "tools/list", None);
        let tools_response = transport.send(tools_request)?;

        if let Some(error) = tools_response.error {
            return Err(AppError::MCP(format!("tools/list failed: {}", error)));
        }

        let tools_result: ToolsListResult = tools_response
            .result
            .ok_or_else(|| AppError::MCP("No tools/list result".to_string()))
            .and_then(|r| {
                serde_json::from_value(r)
                    .map_err(|e| AppError::MCP(format!("Failed to parse tools list: {}", e)))
            })?;

        let tools = tools_result.tools.clone();

        // Store the connection
        let connection = MCPConnection {
            config: config.clone(),
            transport,
            tools: tools_result.tools,
            initialized: true,
        };

        let connection_key = format!("{}:{}", config.agent_type, config.server_name);

        let mut connections = self.connections.write().map_err(|_| {
            AppError::MCP("Failed to lock connections".to_string())
        })?;

        connections.insert(connection_key, connection);

        println!(
            "[MCP] Connected to {} ({} tools)",
            config.server_name,
            tools.len()
        );

        Ok(tools)
    }

    /// Disconnect from an MCP server
    #[allow(dead_code)]
    pub fn disconnect(&self, agent_type: &str, server_name: &str) -> AppResult<()> {
        let connection_key = format!("{}:{}", agent_type, server_name);

        let mut connections = self.connections.write().map_err(|_| {
            AppError::MCP("Failed to lock connections".to_string())
        })?;

        if let Some(connection) = connections.remove(&connection_key) {
            connection.transport.close()?;
            println!("[MCP] Disconnected from {}", server_name);
        }

        Ok(())
    }

    /// Disconnect all servers
    #[allow(dead_code)]
    pub fn disconnect_all(&self) -> AppResult<()> {
        let mut connections = self.connections.write().map_err(|_| {
            AppError::MCP("Failed to lock connections".to_string())
        })?;

        for (key, connection) in connections.drain() {
            let _ = connection.transport.close();
            println!("[MCP] Disconnected from {}", key);
        }

        Ok(())
    }

    /// Get tool definitions for a specific agent type
    pub fn get_tools_for_agent(&self, agent_type: &str) -> AppResult<Vec<ToolDefinition>> {
        let connections = self.connections.read().map_err(|_| {
            AppError::MCP("Failed to lock connections".to_string())
        })?;

        let mut tools = Vec::new();

        for (key, connection) in connections.iter() {
            if key.starts_with(&format!("{}:", agent_type)) {
                for mcp_tool in &connection.tools {
                    tools.push(ToolDefinition {
                        name: format!("mcp_{}_{}", connection.config.server_name, mcp_tool.name),
                        description: mcp_tool
                            .description
                            .clone()
                            .unwrap_or_else(|| format!("MCP tool from {}", connection.config.server_name)),
                        parameters: mcp_tool.input_schema.clone(),
                        source: ToolSource::MCP {
                            server_name: connection.config.server_name.clone(),
                        },
                    });
                }
            }
        }

        Ok(tools)
    }

    /// Execute an MCP tool
    pub fn execute_tool(
        &self,
        agent_type: &str,
        server_name: &str,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> AppResult<ToolResult> {
        let connection_key = format!("{}:{}", agent_type, server_name);
        let call_id = uuid::Uuid::new_v4().to_string();

        let connections = self.connections.read().map_err(|_| {
            AppError::MCP("Failed to lock connections".to_string())
        })?;

        let connection = connections.get(&connection_key).ok_or_else(|| {
            AppError::MCP(format!("No connection to MCP server: {}", server_name))
        })?;

        // Build tools/call request
        let request = JsonRpcRequest::new(
            0, // Will be assigned by transport
            "tools/call",
            Some(json!({
                "name": tool_name,
                "arguments": arguments
            })),
        );

        let response = connection.transport.send(request)?;

        if let Some(error) = response.error {
            return Ok(ToolResult::error(call_id, error.to_string()));
        }

        let result: ToolCallResult = response
            .result
            .ok_or_else(|| AppError::MCP("No tools/call result".to_string()))
            .and_then(|r| {
                serde_json::from_value(r)
                    .map_err(|e| AppError::MCP(format!("Failed to parse tool result: {}", e)))
            })?;

        // Convert MCP content to string output
        let output = result
            .content
            .iter()
            .filter_map(|c| {
                match c.content_type.as_str() {
                    "text" => c.text.clone(),
                    "image" => Some(format!("[Image: {}]", c.mime_type.as_deref().unwrap_or("unknown"))),
                    _ => c.text.clone(),
                }
            })
            .collect::<Vec<_>>()
            .join("\n");

        if result.is_error.unwrap_or(false) {
            Ok(ToolResult::error(call_id, output))
        } else {
            Ok(ToolResult::success(call_id, output))
        }
    }

    /// Check if a tool is from MCP and parse server/tool name
    pub fn parse_mcp_tool_name(full_name: &str) -> Option<(String, String)> {
        if !full_name.starts_with("mcp_") {
            return None;
        }

        let rest = &full_name[4..]; // Remove "mcp_" prefix
        let parts: Vec<&str> = rest.splitn(2, '_').collect();
        if parts.len() == 2 {
            Some((parts[0].to_string(), parts[1].to_string()))
        } else {
            None
        }
    }

    /// Test connection to an MCP server (connect and immediately disconnect)
    pub fn test_connection(&self, config: &MCPServerConfig) -> AppResult<Vec<MCPTool>> {
        // Don't store in connections, just test
        let transport: Box<dyn MCPTransport> = match config.transport_type.as_str() {
            "http" => {
                let url = config.http_url.as_ref().ok_or_else(|| {
                    AppError::MCP("HTTP transport requires http_url".to_string())
                })?;
                Box::new(HttpTransport::new(url)?)
            }
            "stdio" | _ => {
                Box::new(StdioTransport::new(
                    &config.server_command,
                    &config.server_args,
                    &config.server_env,
                )?)
            }
        };

        // Initialize
        let init_request = JsonRpcRequest::new(
            1,
            "initialize",
            Some(json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "roots": { "listChanged": false }
                },
                "clientInfo": {
                    "name": "SiftPR",
                    "version": env!("CARGO_PKG_VERSION")
                }
            })),
        );

        let init_response = transport.send(init_request)?;

        if let Some(error) = init_response.error {
            return Err(AppError::MCP(format!("Initialize failed: {}", error)));
        }

        // List tools
        let tools_request = JsonRpcRequest::new(2, "tools/list", None);
        let tools_response = transport.send(tools_request)?;

        if let Some(error) = tools_response.error {
            return Err(AppError::MCP(format!("tools/list failed: {}", error)));
        }

        let tools_result: ToolsListResult = tools_response
            .result
            .ok_or_else(|| AppError::MCP("No tools/list result".to_string()))
            .and_then(|r| {
                serde_json::from_value(r)
                    .map_err(|e| AppError::MCP(format!("Failed to parse tools list: {}", e)))
            })?;

        // Close transport
        transport.close()?;

        Ok(tools_result.tools)
    }
}

impl Default for MCPManager {
    fn default() -> Self {
        Self::new()
    }
}
