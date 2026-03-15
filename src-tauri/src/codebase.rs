use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

use crate::db::{CodebasePatterns, CodebaseProfile, ConfigFile, StyleSummary};
use crate::error::{AppError, AppResult};

const MAX_CONFIG_FILE_SIZE: u64 = 50_000; // 50KB max for config files
const MAX_SAMPLE_FILES: usize = 20; // Sample files for style detection

/// Analyze a local repository and generate a codebase profile
pub fn analyze_repository(repo_path: &str) -> AppResult<CodebaseProfile> {
    let path = Path::new(repo_path);

    if !path.exists() {
        return Err(AppError::Internal(format!("Repository path does not exist: {}", repo_path)));
    }

    if !path.is_dir() {
        return Err(AppError::Internal(format!("Path is not a directory: {}", repo_path)));
    }

    // Gather directory structure
    let directory_structure = gather_directory_structure(path)?;

    // Count files and detect languages
    let (file_count, language_breakdown) = analyze_languages(path)?;

    // Find and read config files
    let config_files = find_config_files(path)?;

    // Find and read documentation files (README, CLAUDE.md, ARCHITECTURE.md, etc.)
    let documentation_files = find_documentation_files(path)?;

    // Detect patterns from the codebase
    let patterns = detect_patterns(path, &config_files)?;

    // Analyze code style from sample files
    let style_summary = analyze_style(path)?;

    Ok(CodebaseProfile {
        directory_structure,
        file_count,
        language_breakdown,
        config_files,
        documentation_files,
        patterns,
        style_summary,
    })
}

/// Get the current HEAD commit SHA for a repository
pub fn get_head_commit(repo_path: &str) -> AppResult<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Internal(format!("Failed to run git: {}", e)))?;

    if !output.status.success() {
        return Err(AppError::Internal("Failed to get HEAD commit".to_string()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Check if a commit exists in the repository
pub fn commit_exists(repo_path: &str, commit_sha: &str) -> bool {
    Command::new("git")
        .args(["cat-file", "-t", commit_sha])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get files changed between two commits (added, modified, deleted)
/// Returns (changed_files, deleted_files) as relative paths
pub fn get_changed_files(repo_path: &str, from_commit: &str, to_commit: &str) -> AppResult<(Vec<String>, Vec<String>)> {
    // Get added + modified files
    let output = Command::new("git")
        .args(["diff", "--name-only", "--diff-filter=AM", &format!("{}..{}", from_commit, to_commit)])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Internal(format!("Failed to run git diff: {}", e)))?;

    let changed: Vec<String> = if output.status.success() {
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect()
    } else {
        return Err(AppError::Internal("Failed to get changed files from git".to_string()));
    };

    // Get deleted files
    let output = Command::new("git")
        .args(["diff", "--name-only", "--diff-filter=D", &format!("{}..{}", from_commit, to_commit)])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Internal(format!("Failed to run git diff: {}", e)))?;

    let deleted: Vec<String> = if output.status.success() {
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect()
    } else {
        Vec::new()
    };

    Ok((changed, deleted))
}

fn gather_directory_structure(root: &Path) -> AppResult<Vec<String>> {
    let mut dirs = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");

                // Skip hidden directories and common non-source directories
                if name.starts_with('.') ||
                   name == "node_modules" ||
                   name == "target" ||
                   name == "dist" ||
                   name == "build" ||
                   name == "__pycache__" ||
                   name == "venv" ||
                   name == ".git" {
                    continue;
                }

                if path.is_dir() {
                    if let Ok(rel_path) = path.strip_prefix(root) {
                        dirs.push(rel_path.to_string_lossy().to_string());
                    }
                    stack.push(path);
                }
            }
        }
    }

    dirs.sort();
    dirs.truncate(100); // Limit to top 100 directories
    Ok(dirs)
}

fn analyze_languages(root: &Path) -> AppResult<(u32, HashMap<String, u32>)> {
    let mut file_count = 0u32;
    let mut language_breakdown: HashMap<String, u32> = HashMap::new();

    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");

                // Skip hidden and ignored directories
                if name.starts_with('.') ||
                   name == "node_modules" ||
                   name == "target" ||
                   name == "dist" ||
                   name == "build" ||
                   name == "__pycache__" {
                    continue;
                }

                if path.is_dir() {
                    stack.push(path);
                } else if path.is_file() {
                    file_count += 1;

                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        let lang = extension_to_language(ext);
                        *language_breakdown.entry(lang).or_insert(0) += 1;
                    }
                }
            }
        }
    }

    Ok((file_count, language_breakdown))
}

fn extension_to_language(ext: &str) -> String {
    match ext.to_lowercase().as_str() {
        "rs" => "Rust",
        "ts" | "tsx" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "py" => "Python",
        "go" => "Go",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "rb" => "Ruby",
        "php" => "PHP",
        "cs" => "C#",
        "cpp" | "cc" | "cxx" => "C++",
        "c" | "h" => "C",
        "html" | "htm" => "HTML",
        "css" | "scss" | "sass" | "less" => "CSS",
        "json" => "JSON",
        "yaml" | "yml" => "YAML",
        "toml" => "TOML",
        "md" | "mdx" => "Markdown",
        "sql" => "SQL",
        "sh" | "bash" | "zsh" => "Shell",
        _ => "Other",
    }.to_string()
}

fn find_config_files(root: &Path) -> AppResult<Vec<ConfigFile>> {
    let config_patterns = [
        "package.json",
        "tsconfig.json",
        "vite.config.ts",
        "vite.config.js",
        ".eslintrc",
        ".eslintrc.js",
        ".eslintrc.json",
        ".prettierrc",
        ".prettierrc.json",
        "prettier.config.js",
        "Cargo.toml",
        "pyproject.toml",
        "setup.py",
        "requirements.txt",
        "go.mod",
        "Gemfile",
        "composer.json",
        ".editorconfig",
        "tailwind.config.js",
        "tailwind.config.ts",
    ];

    let mut configs = Vec::new();

    for pattern in config_patterns {
        let config_path = root.join(pattern);
        if config_path.exists() && config_path.is_file() {
            if let Ok(metadata) = config_path.metadata() {
                if metadata.len() <= MAX_CONFIG_FILE_SIZE {
                    if let Ok(content) = fs::read_to_string(&config_path) {
                        configs.push(ConfigFile {
                            path: pattern.to_string(),
                            content,
                        });
                    }
                }
            }
        }
    }

    // Also check for config directories
    let src_config = root.join("src").join("config");
    if src_config.exists() && src_config.is_dir() {
        if let Ok(entries) = fs::read_dir(&src_config) {
            for entry in entries.filter_map(|e| e.ok()).take(5) {
                let path = entry.path();
                if path.is_file() {
                    if let Ok(metadata) = path.metadata() {
                        if metadata.len() <= MAX_CONFIG_FILE_SIZE {
                            if let Ok(content) = fs::read_to_string(&path) {
                                if let Ok(rel_path) = path.strip_prefix(root) {
                                    configs.push(ConfigFile {
                                        path: rel_path.to_string_lossy().to_string(),
                                        content,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(configs)
}

/// Find documentation and architecture files, reading their full content.
/// These provide the AI with high-level understanding of the project.
fn find_documentation_files(root: &Path) -> AppResult<Vec<ConfigFile>> {
    const MAX_DOC_SIZE: u64 = 100_000; // 100KB max per doc

    // Root-level documentation files
    let root_doc_patterns = [
        "README.md",
        "README.rst",
        "README.txt",
        "CLAUDE.md",
        "AGENTS.md",
        "ARCHITECTURE.md",
        "DESIGN.md",
        "CONTRIBUTING.md",
        "DEVELOPMENT.md",
        "HACKING.md",
        "CONVENTIONS.md",
        "STYLE_GUIDE.md",
        "API.md",
        "CHANGELOG.md",
    ];

    let mut docs = Vec::new();

    // Check root-level docs
    for pattern in &root_doc_patterns {
        let doc_path = root.join(pattern);
        if doc_path.exists() && doc_path.is_file() {
            if let Ok(metadata) = doc_path.metadata() {
                if metadata.len() <= MAX_DOC_SIZE {
                    if let Ok(content) = fs::read_to_string(&doc_path) {
                        docs.push(ConfigFile {
                            path: pattern.to_string(),
                            content,
                        });
                    }
                }
            }
        }
    }

    // Also check case-insensitively for common doc patterns
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();

            // Skip if we already found this file via exact match
            if docs.iter().any(|d| d.path == name) {
                continue;
            }

            // Catch variations like readme.md, Architecture.md, etc.
            let is_doc = (lower.starts_with("readme") || lower.starts_with("claude") ||
                lower.starts_with("architecture") || lower.starts_with("design") ||
                lower.starts_with("contributing") || lower.starts_with("development"))
                && (lower.ends_with(".md") || lower.ends_with(".rst") || lower.ends_with(".txt"));

            if is_doc {
                let path = entry.path();
                if path.is_file() {
                    if let Ok(metadata) = path.metadata() {
                        if metadata.len() <= MAX_DOC_SIZE {
                            if let Ok(content) = fs::read_to_string(&path) {
                                docs.push(ConfigFile {
                                    path: name,
                                    content,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Check for docs/ or doc/ directory
    for docs_dir_name in ["docs", "doc", "documentation"] {
        let docs_dir = root.join(docs_dir_name);
        if docs_dir.exists() && docs_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&docs_dir) {
                for entry in entries.filter_map(|e| e.ok()).take(20) {
                    let path = entry.path();
                    if path.is_file() {
                        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                        if ["md", "rst", "txt"].contains(&ext) {
                            if let Ok(metadata) = path.metadata() {
                                if metadata.len() <= MAX_DOC_SIZE {
                                    if let Ok(content) = fs::read_to_string(&path) {
                                        if let Ok(rel_path) = path.strip_prefix(root) {
                                            docs.push(ConfigFile {
                                                path: rel_path.to_string_lossy().to_string(),
                                                content,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(docs)
}

fn detect_patterns(root: &Path, config_files: &[ConfigFile]) -> AppResult<CodebasePatterns> {
    // Detect naming convention from directory structure
    let naming_convention = detect_naming_convention(root);

    // Detect file organization pattern
    let file_organization = detect_file_organization(root);

    // Detect common abstractions from imports and file names
    let common_abstractions = detect_abstractions(root);

    // Detect import style from config or files
    let import_style = detect_import_style(config_files);

    // Detect error handling pattern
    let error_handling_pattern = detect_error_handling(root);

    Ok(CodebasePatterns {
        naming_convention,
        file_organization,
        common_abstractions,
        import_style,
        error_handling_pattern,
    })
}

fn detect_naming_convention(root: &Path) -> String {
    let src_path = root.join("src");
    let check_path = if src_path.exists() { &src_path } else { root };

    let mut snake_count = 0;
    let mut camel_count = 0;
    let mut kebab_count = 0;
    let mut pascal_count = 0;

    if let Ok(entries) = fs::read_dir(check_path) {
        for entry in entries.filter_map(|e| e.ok()).take(50) {
            let name = entry.file_name().to_string_lossy().to_string();
            let stem = name.split('.').next().unwrap_or(&name);

            if stem.contains('_') {
                snake_count += 1;
            } else if stem.contains('-') {
                kebab_count += 1;
            } else if stem.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                pascal_count += 1;
            } else if stem.chars().any(|c| c.is_uppercase()) {
                camel_count += 1;
            }
        }
    }

    let max = *[snake_count, camel_count, kebab_count, pascal_count].iter().max().unwrap_or(&0);

    if max == 0 {
        "mixed".to_string()
    } else if snake_count == max {
        "snake_case".to_string()
    } else if camel_count == max {
        "camelCase".to_string()
    } else if kebab_count == max {
        "kebab-case".to_string()
    } else {
        "PascalCase".to_string()
    }
}

fn detect_file_organization(root: &Path) -> String {
    let src_path = root.join("src");
    let check_path = if src_path.exists() { src_path } else { root.to_path_buf() };

    let mut has_features = false;
    let mut has_components = false;
    let mut has_types = false;
    let mut has_utils = false;
    let mut has_services = false;
    let mut _has_models = false;

    if let Ok(entries) = fs::read_dir(&check_path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name == "features" || name == "modules" { has_features = true; }
            if name == "components" { has_components = true; }
            if name == "types" || name == "interfaces" { has_types = true; }
            if name == "utils" || name == "helpers" || name == "lib" { has_utils = true; }
            if name == "services" || name == "api" { has_services = true; }
            if name == "models" || name == "entities" { _has_models = true; }
        }
    }

    if has_features {
        "feature-based (modules/features)".to_string()
    } else if has_components && has_services {
        "layered (components, services, models)".to_string()
    } else if has_components {
        "component-based".to_string()
    } else if has_types || has_utils {
        "type-based organization".to_string()
    } else {
        "flat structure".to_string()
    }
}

fn detect_abstractions(root: &Path) -> Vec<String> {
    let mut abstractions = Vec::new();
    let src_path = root.join("src");
    let check_path = if src_path.exists() { src_path } else { root.to_path_buf() };

    // Check for common patterns by directory/file names
    if let Ok(entries) = fs::read_dir(&check_path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_lowercase();

            if name.contains("repository") || name.contains("repo") {
                abstractions.push("Repository pattern".to_string());
            }
            if name.contains("service") {
                abstractions.push("Service layer".to_string());
            }
            if name.contains("controller") {
                abstractions.push("MVC/Controller pattern".to_string());
            }
            if name.contains("hook") || name == "hooks" {
                abstractions.push("React Hooks".to_string());
            }
            if name.contains("context") || name == "contexts" {
                abstractions.push("React Context".to_string());
            }
            if name.contains("store") || name.contains("redux") || name.contains("zustand") {
                abstractions.push("State management store".to_string());
            }
            if name.contains("middleware") {
                abstractions.push("Middleware pattern".to_string());
            }
            if name.contains("factory") {
                abstractions.push("Factory pattern".to_string());
            }
        }
    }

    abstractions.sort();
    abstractions.dedup();
    abstractions.truncate(10);
    abstractions
}

fn detect_import_style(config_files: &[ConfigFile]) -> String {
    // Check tsconfig for module settings
    for config in config_files {
        if config.path == "tsconfig.json" {
            if config.content.contains("\"module\": \"ESNext\"") ||
               config.content.contains("\"module\": \"ES") {
                return "ES Modules (import/export)".to_string();
            }
            if config.content.contains("\"module\": \"CommonJS\"") {
                return "CommonJS (require/module.exports)".to_string();
            }
        }
        if config.path == "package.json" {
            if config.content.contains("\"type\": \"module\"") {
                return "ES Modules".to_string();
            }
        }
    }

    "ES Modules (default)".to_string()
}

fn detect_error_handling(root: &Path) -> String {
    // Sample a few source files to detect error handling patterns
    let extensions = ["ts", "tsx", "js", "jsx", "rs", "py", "go"];
    let src_path = root.join("src");
    let check_path = if src_path.exists() { src_path } else { root.to_path_buf() };

    let mut has_try_catch = false;
    let mut has_result_type = false;
    let mut has_error_boundary = false;

    fn check_dir(dir: &Path, extensions: &[&str], has_try_catch: &mut bool, has_result_type: &mut bool, has_error_boundary: &mut bool, depth: usize) {
        if depth > 3 { return; }

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.filter_map(|e| e.ok()).take(20) {
                let path = entry.path();

                if path.is_dir() {
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if !name.starts_with('.') && name != "node_modules" && name != "target" {
                        check_dir(&path, extensions, has_try_catch, has_result_type, has_error_boundary, depth + 1);
                    }
                } else if path.is_file() {
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        if extensions.contains(&ext) {
                            if let Ok(content) = fs::read_to_string(&path) {
                                let sample = &content[..content.len().min(5000)];
                                if sample.contains("try {") || sample.contains("try:") {
                                    *has_try_catch = true;
                                }
                                if sample.contains("Result<") || sample.contains("-> Result") {
                                    *has_result_type = true;
                                }
                                if sample.contains("ErrorBoundary") {
                                    *has_error_boundary = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    check_dir(&check_path, &extensions, &mut has_try_catch, &mut has_result_type, &mut has_error_boundary, 0);

    let mut patterns = Vec::new();
    if has_result_type {
        patterns.push("Result types");
    }
    if has_try_catch {
        patterns.push("try/catch blocks");
    }
    if has_error_boundary {
        patterns.push("Error boundaries");
    }

    if patterns.is_empty() {
        "Not detected".to_string()
    } else {
        patterns.join(", ")
    }
}

fn analyze_style(root: &Path) -> AppResult<StyleSummary> {
    let src_path = root.join("src");
    let check_path = if src_path.exists() { src_path } else { root.to_path_buf() };

    let mut indentation = "2 spaces".to_string();
    let mut quote_style = "single".to_string();
    let mut trailing_commas = true;
    let mut documentation_style = "JSDoc/inline".to_string();
    let mut total_lines = 0u32;
    let mut file_count = 0u32;

    // Check .editorconfig and prettier config first
    let editorconfig = root.join(".editorconfig");
    if editorconfig.exists() {
        if let Ok(content) = fs::read_to_string(&editorconfig) {
            if content.contains("indent_size = 4") {
                indentation = "4 spaces".to_string();
            } else if content.contains("indent_style = tab") {
                indentation = "tabs".to_string();
            }
        }
    }

    // Check prettier config
    for name in [".prettierrc", ".prettierrc.json", "prettier.config.js"] {
        let prettier_path = root.join(name);
        if prettier_path.exists() {
            if let Ok(content) = fs::read_to_string(&prettier_path) {
                if content.contains("\"tabWidth\": 4") || content.contains("tabWidth: 4") {
                    indentation = "4 spaces".to_string();
                }
                if content.contains("\"singleQuote\": false") || content.contains("singleQuote: false") {
                    quote_style = "double".to_string();
                }
                if content.contains("\"trailingComma\": \"none\"") || content.contains("trailingComma: \"none\"") {
                    trailing_commas = false;
                }
            }
            break;
        }
    }

    // Sample files for style detection and line counts
    fn sample_files(dir: &Path, total_lines: &mut u32, file_count: &mut u32, depth: usize) {
        if depth > 3 || *file_count > MAX_SAMPLE_FILES as u32 { return; }

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                if path.is_dir() {
                    if !name.starts_with('.') && name != "node_modules" && name != "target" && name != "dist" {
                        sample_files(&path, total_lines, file_count, depth + 1);
                    }
                } else if path.is_file() && *file_count < MAX_SAMPLE_FILES as u32 {
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        if ["ts", "tsx", "js", "jsx", "rs", "py", "go"].contains(&ext) {
                            if let Ok(content) = fs::read_to_string(&path) {
                                *total_lines += content.lines().count() as u32;
                                *file_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    sample_files(&check_path, &mut total_lines, &mut file_count, 0);

    let typical_file_length = if file_count > 0 {
        total_lines / file_count
    } else {
        100
    };

    // Check for documentation style
    let readme = root.join("README.md");
    if readme.exists() {
        documentation_style = "README + inline".to_string();
    }

    Ok(StyleSummary {
        indentation,
        quote_style,
        trailing_commas,
        documentation_style,
        typical_file_length,
    })
}

/// Generate a context summary for injection into AI prompts
pub fn generate_context_summary(profile: &CodebaseProfile) -> String {
    let mut summary = String::new();

    summary.push_str("## Codebase Context (from local analysis)\n\n");

    // Language breakdown
    let mut langs: Vec<_> = profile.language_breakdown.iter().collect();
    langs.sort_by(|a, b| b.1.cmp(a.1));
    let top_langs: Vec<_> = langs.iter().take(3).map(|(k, _)| k.as_str()).collect();
    summary.push_str(&format!("**Primary Languages:** {}\n", top_langs.join(", ")));
    summary.push_str(&format!("**Total Files:** {}\n\n", profile.file_count));

    // Organization
    summary.push_str(&format!("**Structure:** {}\n", profile.patterns.file_organization));
    summary.push_str(&format!("**Naming:** {}\n\n", profile.patterns.naming_convention));

    // Patterns
    if !profile.patterns.common_abstractions.is_empty() {
        summary.push_str("**Key Patterns:**\n");
        for abstraction in &profile.patterns.common_abstractions {
            summary.push_str(&format!("- {}\n", abstraction));
        }
        summary.push('\n');
    }

    // Style
    summary.push_str(&format!("**Style:** {} indent, {} quotes",
        profile.style_summary.indentation,
        profile.style_summary.quote_style
    ));
    if profile.style_summary.trailing_commas {
        summary.push_str(", trailing commas");
    }
    summary.push('\n');
    summary.push_str(&format!("**Typical file:** ~{} lines\n\n", profile.style_summary.typical_file_length));

    // Error handling
    summary.push_str(&format!("**Error handling:** {}\n", profile.patterns.error_handling_pattern));

    // Config highlights
    if !profile.config_files.is_empty() {
        summary.push_str("\n**Config files present:**\n");
        for config in profile.config_files.iter().take(5) {
            summary.push_str(&format!("- {}\n", config.path));
        }
    }

    // Documentation content — this is the most valuable context for AI agents
    if !profile.documentation_files.is_empty() {
        summary.push_str("\n---\n\n## Project Documentation\n\n");
        for doc in &profile.documentation_files {
            summary.push_str(&format!("### {}\n\n", doc.path));
            // Truncate very long docs to keep context manageable
            let content = if doc.content.len() > 8000 {
                format!("{}...\n\n(truncated, {} total chars)", &doc.content[..8000], doc.content.len())
            } else {
                doc.content.clone()
            };
            summary.push_str(&content);
            summary.push_str("\n\n");
        }
    }

    summary
}
