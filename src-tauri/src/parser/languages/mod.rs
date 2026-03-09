//! Language-specific Tree-sitter grammar loading and query definitions

use tree_sitter::Language as TSLanguage;

use super::Language;
use crate::error::{AppError, AppResult};

/// Get the Tree-sitter language for a given language type
pub fn get_language(lang: Language) -> AppResult<TSLanguage> {
    match lang {
        Language::Rust => Ok(tree_sitter_rust::LANGUAGE.into()),
        Language::TypeScript => Ok(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        Language::JavaScript => Ok(tree_sitter_javascript::LANGUAGE.into()),
        Language::Python => Ok(tree_sitter_python::LANGUAGE.into()),
        Language::Go => Ok(tree_sitter_go::LANGUAGE.into()),
        Language::Unknown => Err(AppError::Parser("Unknown language".to_string())),
    }
}

/// Tree-sitter queries for extracting code structures from Rust
pub const RUST_QUERIES: &str = r#"
; Functions
(function_item
  name: (identifier) @name
  parameters: (parameters) @params
  return_type: (_)? @return_type
) @function

; Methods in impl blocks
(impl_item
  type: (_) @impl_type
  body: (declaration_list
    (function_item
      name: (identifier) @method_name
      parameters: (parameters) @method_params
    ) @method
  )
)

; Structs
(struct_item
  name: (type_identifier) @struct_name
) @struct

; Enums
(enum_item
  name: (type_identifier) @enum_name
) @enum

; Traits
(trait_item
  name: (type_identifier) @trait_name
) @trait

; Modules
(mod_item
  name: (identifier) @mod_name
) @module
"#;

/// Tree-sitter queries for extracting code structures from TypeScript/JavaScript
pub const TYPESCRIPT_QUERIES: &str = r#"
; Functions
(function_declaration
  name: (identifier) @name
) @function

; Arrow functions assigned to const/let
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function)
  )
) @arrow_function

; Methods in classes
(class_declaration
  name: (type_identifier) @class_name
  body: (class_body
    (method_definition
      name: (property_identifier) @method_name
    ) @method
  )
) @class

; Interfaces
(interface_declaration
  name: (type_identifier) @interface_name
) @interface

; Type aliases
(type_alias_declaration
  name: (type_identifier) @type_name
) @type_alias
"#;

/// Tree-sitter queries for extracting code structures from Python
pub const PYTHON_QUERIES: &str = r#"
; Functions
(function_definition
  name: (identifier) @name
) @function

; Methods in classes
(class_definition
  name: (identifier) @class_name
  body: (block
    (function_definition
      name: (identifier) @method_name
    ) @method
  )
) @class
"#;

/// Tree-sitter queries for extracting code structures from Go
pub const GO_QUERIES: &str = r#"
; Functions
(function_declaration
  name: (identifier) @name
) @function

; Methods
(method_declaration
  name: (field_identifier) @name
  receiver: (parameter_list) @receiver
) @method

; Structs
(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (struct_type)
  )
) @struct

; Interfaces
(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (interface_type)
  )
) @interface
"#;

/// Get query patterns for a language
pub fn get_queries(lang: Language) -> &'static str {
    match lang {
        Language::Rust => RUST_QUERIES,
        Language::TypeScript | Language::JavaScript => TYPESCRIPT_QUERIES,
        Language::Python => PYTHON_QUERIES,
        Language::Go => GO_QUERIES,
        Language::Unknown => "",
    }
}
