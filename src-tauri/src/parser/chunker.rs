//! Code chunk extraction using Tree-sitter AST parsing

use std::path::Path;
use tree_sitter::{Parser, Node};

use super::{CodeChunk, Language, languages};
use crate::db::ChunkType;
use crate::error::{AppError, AppResult};

/// Maximum lines for a single chunk (larger functions are still included)
const MAX_CHUNK_LINES: u32 = 500;

/// Minimum lines for a chunk to be included
const MIN_CHUNK_LINES: u32 = 3;

/// Extract code chunks from source code
pub fn extract_chunks(source: &str, language: Language, path: &Path) -> AppResult<Vec<CodeChunk>> {
    let ts_language = languages::get_language(language)?;

    let mut parser = Parser::new();
    parser.set_language(&ts_language)
        .map_err(|e| AppError::Parser(format!("Failed to set language: {}", e)))?;

    let tree = parser.parse(source, None)
        .ok_or_else(|| AppError::Parser("Failed to parse source".to_string()))?;

    let file_path = path.to_string_lossy().to_string();
    let lang_str = language.as_str().to_string();

    // Extract chunks based on language
    match language {
        Language::Rust => extract_rust_chunks(source, &tree.root_node(), &file_path, &lang_str),
        Language::TypeScript | Language::JavaScript => extract_typescript_chunks(source, &tree.root_node(), &file_path, &lang_str),
        Language::Python => extract_python_chunks(source, &tree.root_node(), &file_path, &lang_str),
        Language::Go => extract_go_chunks(source, &tree.root_node(), &file_path, &lang_str),
        Language::Unknown => Ok(Vec::new()),
    }
}

/// Extract chunks from Rust source code
fn extract_rust_chunks(source: &str, root: &Node, file_path: &str, language: &str) -> AppResult<Vec<CodeChunk>> {
    let mut chunks = Vec::new();
    let mut cursor = root.walk();

    // Walk through all top-level items
    for child in root.children(&mut cursor) {
        match child.kind() {
            "function_item" => {
                if let Some(chunk) = extract_rust_function(source, &child, file_path, language, None) {
                    chunks.push(chunk);
                }
            }
            "struct_item" => {
                if let Some(chunk) = extract_rust_struct(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            "enum_item" => {
                if let Some(chunk) = extract_rust_enum(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            "trait_item" => {
                if let Some(chunk) = extract_rust_trait(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            "impl_item" => {
                // Extract methods from impl blocks
                chunks.extend(extract_rust_impl_methods(source, &child, file_path, language));
            }
            "mod_item" => {
                if let Some(chunk) = extract_rust_module(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            _ => {}
        }
    }

    Ok(chunks)
}

fn extract_rust_function(source: &str, node: &Node, file_path: &str, language: &str, parent: Option<&str>) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let signature = extract_rust_fn_signature(source, node);
    let visibility = extract_rust_visibility(node);
    let docstring = extract_preceding_comments(source, node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: if parent.is_some() { ChunkType::Method } else { ChunkType::Function },
        name: name.to_string(),
        signature,
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: parent.map(|s| s.to_string()),
        visibility,
    })
}

fn extract_rust_fn_signature(source: &str, node: &Node) -> Option<String> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let params = node.child_by_field_name("parameters")?.utf8_text(source.as_bytes()).ok()?;
    let return_type = node.child_by_field_name("return_type")
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .map(|s| format!(" {}", s))
        .unwrap_or_default();

    Some(format!("fn {}{}{}", name, params, return_type))
}

fn extract_rust_visibility(node: &Node) -> Option<String> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "visibility_modifier" {
            return Some("public".to_string());
        }
    }
    Some("private".to_string())
}

fn extract_rust_struct(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let docstring = extract_preceding_comments(source, node);
    let visibility = extract_rust_visibility(node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Struct,
        name: name.to_string(),
        signature: Some(format!("struct {}", name)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: None,
        visibility,
    })
}

fn extract_rust_enum(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let docstring = extract_preceding_comments(source, node);
    let visibility = extract_rust_visibility(node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Enum,
        name: name.to_string(),
        signature: Some(format!("enum {}", name)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: None,
        visibility,
    })
}

fn extract_rust_trait(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let docstring = extract_preceding_comments(source, node);
    let visibility = extract_rust_visibility(node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Trait,
        name: name.to_string(),
        signature: Some(format!("trait {}", name)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: None,
        visibility,
    })
}

fn extract_rust_module(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    // Only include module declarations, not inline modules
    if end_line - start_line > 5 {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let docstring = extract_preceding_comments(source, node);
    let visibility = extract_rust_visibility(node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Module,
        name: name.to_string(),
        signature: Some(format!("mod {}", name)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: None,
        visibility,
    })
}

fn extract_rust_impl_methods(source: &str, node: &Node, file_path: &str, language: &str) -> Vec<CodeChunk> {
    let mut chunks = Vec::new();

    // Get the impl type name
    let impl_type = node.child_by_field_name("type")
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .map(|s| s.to_string());

    // Find the declaration_list (body)
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "declaration_list" {
            let mut body_cursor = child.walk();
            for body_child in child.children(&mut body_cursor) {
                if body_child.kind() == "function_item" {
                    if let Some(chunk) = extract_rust_function(source, &body_child, file_path, language, impl_type.as_deref()) {
                        chunks.push(chunk);
                    }
                }
            }
        }
    }

    chunks
}

/// Extract chunks from TypeScript/JavaScript source code
fn extract_typescript_chunks(source: &str, root: &Node, file_path: &str, language: &str) -> AppResult<Vec<CodeChunk>> {
    let mut chunks = Vec::new();
    extract_typescript_chunks_recursive(source, root, file_path, language, None, &mut chunks);
    Ok(chunks)
}

fn extract_typescript_chunks_recursive(
    source: &str,
    node: &Node,
    file_path: &str,
    language: &str,
    parent_class: Option<&str>,
    chunks: &mut Vec<CodeChunk>,
) {
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_declaration" => {
                if let Some(chunk) = extract_ts_function(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            "lexical_declaration" | "variable_declaration" => {
                // Check for arrow functions
                if let Some(chunk) = extract_ts_arrow_function(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            "class_declaration" => {
                if let Some((class_chunk, class_name)) = extract_ts_class(source, &child, file_path, language) {
                    chunks.push(class_chunk);
                    // Recursively extract methods
                    if let Some(body) = child.child_by_field_name("body") {
                        extract_typescript_chunks_recursive(source, &body, file_path, language, Some(&class_name), chunks);
                    }
                }
            }
            "method_definition" => {
                if let Some(chunk) = extract_ts_method(source, &child, file_path, language, parent_class) {
                    chunks.push(chunk);
                }
            }
            "interface_declaration" => {
                if let Some(chunk) = extract_ts_interface(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            "type_alias_declaration" => {
                // Type aliases are usually small, skip them
            }
            "export_statement" => {
                // Recurse into export statements
                extract_typescript_chunks_recursive(source, &child, file_path, language, parent_class, chunks);
            }
            _ => {
                // Recurse into other nodes
                extract_typescript_chunks_recursive(source, &child, file_path, language, parent_class, chunks);
            }
        }
    }
}

fn extract_ts_function(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let signature = extract_ts_fn_signature(source, node, name);
    let docstring = extract_preceding_comments(source, node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Function,
        name: name.to_string(),
        signature,
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: None,
        visibility: Some("public".to_string()),
    })
}

fn extract_ts_fn_signature(source: &str, node: &Node, name: &str) -> Option<String> {
    let params = node.child_by_field_name("parameters")
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .unwrap_or("()");

    Some(format!("function {}{}", name, params))
}

fn extract_ts_arrow_function(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator" {
            let name = child.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
            let value = child.child_by_field_name("value")?;

            if value.kind() == "arrow_function" {
                let (start_line, end_line) = get_line_range(node);

                if !is_valid_chunk_size(start_line, end_line) {
                    return None;
                }

                let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
                let docstring = extract_preceding_comments(source, node);

                return Some(CodeChunk {
                    file_path: file_path.to_string(),
                    chunk_type: ChunkType::Function,
                    name: name.to_string(),
                    signature: Some(format!("const {} = () => ...", name)),
                    language: language.to_string(),
                    start_line,
                    end_line,
                    content,
                    docstring,
                    parent_name: None,
                    visibility: Some("public".to_string()),
                });
            }
        }
    }
    None
}

fn extract_ts_class(source: &str, node: &Node, file_path: &str, language: &str) -> Option<(CodeChunk, String)> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    // For classes, we want to include them even if large
    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let docstring = extract_preceding_comments(source, node);

    let chunk = CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Class,
        name: name.to_string(),
        signature: Some(format!("class {}", name)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: None,
        visibility: Some("public".to_string()),
    };

    Some((chunk, name.to_string()))
}

fn extract_ts_method(source: &str, node: &Node, file_path: &str, language: &str, parent: Option<&str>) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let docstring = extract_preceding_comments(source, node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Method,
        name: name.to_string(),
        signature: Some(format!("{}()", name)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: parent.map(|s| s.to_string()),
        visibility: Some("public".to_string()),
    })
}

fn extract_ts_interface(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let docstring = extract_preceding_comments(source, node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Interface,
        name: name.to_string(),
        signature: Some(format!("interface {}", name)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: None,
        visibility: Some("public".to_string()),
    })
}

/// Extract chunks from Python source code
fn extract_python_chunks(source: &str, root: &Node, file_path: &str, language: &str) -> AppResult<Vec<CodeChunk>> {
    let mut chunks = Vec::new();
    extract_python_chunks_recursive(source, root, file_path, language, None, &mut chunks);
    Ok(chunks)
}

fn extract_python_chunks_recursive(
    source: &str,
    node: &Node,
    file_path: &str,
    language: &str,
    parent_class: Option<&str>,
    chunks: &mut Vec<CodeChunk>,
) {
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_definition" => {
                if let Some(chunk) = extract_python_function(source, &child, file_path, language, parent_class) {
                    chunks.push(chunk);
                }
            }
            "class_definition" => {
                let class_name = child.child_by_field_name("name")
                    .and_then(|n| n.utf8_text(source.as_bytes()).ok())
                    .map(|s| s.to_string());

                if let Some(chunk) = extract_python_class(source, &child, file_path, language) {
                    chunks.push(chunk);
                }

                // Extract methods from class body
                if let Some(body) = child.child_by_field_name("body") {
                    extract_python_chunks_recursive(source, &body, file_path, language, class_name.as_deref(), chunks);
                }
            }
            _ => {
                extract_python_chunks_recursive(source, &child, file_path, language, parent_class, chunks);
            }
        }
    }
}

fn extract_python_function(source: &str, node: &Node, file_path: &str, language: &str, parent: Option<&str>) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let params = node.child_by_field_name("parameters")
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .unwrap_or("()");
    let docstring = extract_python_docstring(&node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: if parent.is_some() { ChunkType::Method } else { ChunkType::Function },
        name: name.to_string(),
        signature: Some(format!("def {}{}", name, params)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: parent.map(|s| s.to_string()),
        visibility: if name.starts_with('_') { Some("private".to_string()) } else { Some("public".to_string()) },
    })
}

fn extract_python_class(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let docstring = extract_python_docstring(&node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Class,
        name: name.to_string(),
        signature: Some(format!("class {}", name)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: None,
        visibility: Some("public".to_string()),
    })
}

fn extract_python_docstring(node: &Node) -> Option<String> {
    // Python docstrings are the first statement in a function/class body
    let body = node.child_by_field_name("body")?;
    let mut cursor = body.walk();

    for child in body.children(&mut cursor) {
        if child.kind() == "expression_statement" {
            let mut inner_cursor = child.walk();
            for inner in child.children(&mut inner_cursor) {
                if inner.kind() == "string" {
                    // This is likely a docstring
                    return None; // Would need source to extract text
                }
            }
        }
        break; // Only check the first statement
    }
    None
}

/// Extract chunks from Go source code
fn extract_go_chunks(source: &str, root: &Node, file_path: &str, language: &str) -> AppResult<Vec<CodeChunk>> {
    let mut chunks = Vec::new();
    let mut cursor = root.walk();

    for child in root.children(&mut cursor) {
        match child.kind() {
            "function_declaration" => {
                if let Some(chunk) = extract_go_function(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            "method_declaration" => {
                if let Some(chunk) = extract_go_method(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            "type_declaration" => {
                if let Some(chunk) = extract_go_type(source, &child, file_path, language) {
                    chunks.push(chunk);
                }
            }
            _ => {}
        }
    }

    Ok(chunks)
}

fn extract_go_function(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let params = node.child_by_field_name("parameters")
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .unwrap_or("()");
    let docstring = extract_preceding_comments(source, node);

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Function,
        name: name.to_string(),
        signature: Some(format!("func {}{}", name, params)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name: None,
        visibility: if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
            Some("public".to_string())
        } else {
            Some("private".to_string())
        },
    })
}

fn extract_go_method(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let name = node.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
    let receiver = node.child_by_field_name("receiver")
        .and_then(|n| n.utf8_text(source.as_bytes()).ok());
    let (start_line, end_line) = get_line_range(node);

    if !is_valid_chunk_size(start_line, end_line) {
        return None;
    }

    let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
    let docstring = extract_preceding_comments(source, node);

    // Extract receiver type name
    let parent_name = receiver.and_then(|r| {
        // Receiver is like "(t *Type)" or "(t Type)"
        r.split_whitespace().last().map(|s| s.trim_start_matches('*').to_string())
    });

    Some(CodeChunk {
        file_path: file_path.to_string(),
        chunk_type: ChunkType::Method,
        name: name.to_string(),
        signature: Some(format!("func {} {}", receiver.unwrap_or("()"), name)),
        language: language.to_string(),
        start_line,
        end_line,
        content,
        docstring,
        parent_name,
        visibility: if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
            Some("public".to_string())
        } else {
            Some("private".to_string())
        },
    })
}

fn extract_go_type(source: &str, node: &Node, file_path: &str, language: &str) -> Option<CodeChunk> {
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        if child.kind() == "type_spec" {
            let name = child.child_by_field_name("name")?.utf8_text(source.as_bytes()).ok()?;
            let type_node = child.child_by_field_name("type")?;

            let (chunk_type, type_keyword) = match type_node.kind() {
                "struct_type" => (ChunkType::Struct, "struct"),
                "interface_type" => (ChunkType::Interface, "interface"),
                _ => return None,
            };

            let (start_line, end_line) = get_line_range(node);

            if !is_valid_chunk_size(start_line, end_line) {
                return None;
            }

            let content = node.utf8_text(source.as_bytes()).ok()?.to_string();
            let docstring = extract_preceding_comments(source, node);

            return Some(CodeChunk {
                file_path: file_path.to_string(),
                chunk_type,
                name: name.to_string(),
                signature: Some(format!("type {} {}", name, type_keyword)),
                language: language.to_string(),
                start_line,
                end_line,
                content,
                docstring,
                parent_name: None,
                visibility: if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                    Some("public".to_string())
                } else {
                    Some("private".to_string())
                },
            });
        }
    }
    None
}

// Helper functions

fn get_line_range(node: &Node) -> (u32, u32) {
    let start = node.start_position().row as u32 + 1;
    let end = node.end_position().row as u32 + 1;
    (start, end)
}

fn is_valid_chunk_size(start_line: u32, end_line: u32) -> bool {
    let lines = end_line - start_line + 1;
    lines >= MIN_CHUNK_LINES && lines <= MAX_CHUNK_LINES
}

fn extract_preceding_comments(source: &str, node: &Node) -> Option<String> {
    // Look for comments immediately before this node
    let start_line = node.start_position().row;
    if start_line == 0 {
        return None;
    }

    let lines: Vec<&str> = source.lines().collect();
    let mut comment_lines = Vec::new();
    let mut line_idx = start_line.saturating_sub(1);

    // Walk backwards to find comments
    while line_idx > 0 {
        let line = lines.get(line_idx).map(|s| s.trim()).unwrap_or("");

        if line.starts_with("///") || line.starts_with("//!") {
            // Rust doc comment
            comment_lines.push(line.trim_start_matches('/').trim());
        } else if line.starts_with("//") {
            // Regular comment
            comment_lines.push(line.trim_start_matches('/').trim());
        } else if line.starts_with('#') {
            // Python comment
            comment_lines.push(line.trim_start_matches('#').trim());
        } else if line.starts_with("*") || line.starts_with("/*") || line.ends_with("*/") {
            // C-style block comment
            comment_lines.push(line.trim_start_matches(&['/', '*', ' '][..]).trim_end_matches(&['/', '*', ' '][..]));
        } else if line.is_empty() && !comment_lines.is_empty() {
            // Allow one blank line in comments
            if comment_lines.last().map(|s| !s.is_empty()).unwrap_or(false) {
                comment_lines.push("");
            } else {
                break;
            }
        } else if !line.is_empty() {
            break;
        }

        if line_idx == 0 {
            break;
        }
        line_idx -= 1;
    }

    if comment_lines.is_empty() {
        return None;
    }

    comment_lines.reverse();
    Some(comment_lines.join("\n").trim().to_string())
}
