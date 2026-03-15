use std::collections::HashMap;

use crate::github::GitHubFile;

use super::super::types::AgentType;

/// Threshold for activating file triage (number of files in PR)
pub const TRIAGE_FILE_THRESHOLD: usize = 15;

/// Result of triaging files for a specific agent
pub struct TriagedFiles<'a> {
    /// Files that get full diffs (high relevance to this agent)
    pub primary: Vec<&'a GitHubFile>,
    /// Files that get summary only (low relevance to this agent)
    pub secondary: Vec<&'a GitHubFile>,
}

/// Triage PR files by relevance to each agent type using heuristic keyword matching.
///
/// Each file is classified as primary (full diff) or secondary (summary only) per agent.
/// A file can be primary for multiple agents. If triage produces zero primary files
/// for an agent, the caller should fall back to sending all files.
pub fn triage_files(files: &[GitHubFile]) -> HashMap<AgentType, TriagedFiles<'_>> {
    let mut result = HashMap::new();

    for agent_type in &[
        AgentType::Security,
        AgentType::Architecture,
        AgentType::Style,
        AgentType::Performance,
    ] {
        let mut primary = Vec::new();
        let mut secondary = Vec::new();

        for file in files {
            if is_primary_for(file, *agent_type) {
                primary.push(file);
            } else {
                secondary.push(file);
            }
        }

        result.insert(*agent_type, TriagedFiles { primary, secondary });
    }

    result
}

/// Determine whether a file is primary (high relevance) for a given agent type.
fn is_primary_for(file: &GitHubFile, agent_type: AgentType) -> bool {
    let filename_lower = file.filename.to_lowercase();
    let patch_lower = file.patch.as_ref().map(|p| p.to_lowercase());

    match agent_type {
        AgentType::Security => {
            // Security-relevant filename patterns
            let security_filename_keywords = [
                "auth", "login", "token", "session", "password", "credential",
                "secret", "crypto", "encrypt", "decrypt", "oauth", "jwt",
                "permission", "role", "acl", "access", "sanitiz", "validat",
                "csrf", "cors", "security", "middleware", ".env",
            ];
            if security_filename_keywords.iter().any(|k| filename_lower.contains(k)) {
                return true;
            }

            // Security-relevant diff content patterns
            if let Some(ref patch) = patch_lower {
                let security_content_keywords = [
                    "password", "secret", "api_key", "apikey", "api-key", "token",
                    "bearer", "authorization", "authenticate", "sql", "query",
                    "exec(", "eval(", "innerhtml", "dangerouslysetinnerhtml",
                    "cookie", "session", "hash", "encrypt", "decrypt",
                    "cors", "csrf", "sanitiz", "escape",
                ];
                if security_content_keywords.iter().any(|k| patch.contains(k)) {
                    return true;
                }
            }

            false
        }

        AgentType::Architecture => {
            // Architecture-relevant filename patterns
            let arch_filename_keywords = [
                "mod.rs", "lib.rs", "main.rs", "index.ts", "index.js",
                "interface", "trait", "abstract", "factory", "provider",
                "service", "repository", "controller", "handler", "router",
                "route", "schema", "migration", "config", "types",
            ];
            if arch_filename_keywords.iter().any(|k| filename_lower.contains(k)) {
                return true;
            }

            // Architecture-relevant diff content patterns
            if let Some(ref patch) = patch_lower {
                let arch_content_keywords = [
                    "pub trait", "pub struct", "pub enum", "pub fn",
                    "interface ", "export class", "export interface", "export type",
                    "import ", "module", "breaking", "deprecated",
                ];
                if arch_content_keywords.iter().any(|k| patch.contains(k)) {
                    return true;
                }
            }

            // Files with many changes often have architectural significance
            if file.additions + file.deletions > 50 {
                return true;
            }

            false
        }

        AgentType::Style => {
            // Style agent gets all files with 5+ changed lines as primary
            file.additions + file.deletions >= 5
        }

        AgentType::Performance => {
            // Performance-relevant filename patterns
            let perf_filename_keywords = [
                "query", "database", "db", "cache", "redis", "pool",
                "worker", "queue", "batch", "stream", "buffer",
                "index", "search", "async", "concurrent", "parallel",
                "render", "component", "hook",
            ];
            if perf_filename_keywords.iter().any(|k| filename_lower.contains(k)) {
                return true;
            }

            // Performance-relevant diff content patterns
            if let Some(ref patch) = patch_lower {
                let perf_content_keywords = [
                    "query", "select ", "insert ", "update ", "delete ",
                    "cache", "memoiz", "usememo", "usecallback",
                    "async ", "await ", ".then(", "promise",
                    "loop", "for ", "while ", ".map(", ".filter(", ".foreach(",
                    "timeout", "interval", "debounce", "throttle",
                    "spawn", "thread", "mutex", "lock",
                    "o(n", "o(n²", "o(n^2",
                ];
                if perf_content_keywords.iter().any(|k| patch.contains(k)) {
                    return true;
                }
            }

            false
        }

        // Research and Profiler agents don't participate in triage
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_file(filename: &str, additions: i64, deletions: i64, patch: Option<&str>) -> GitHubFile {
        GitHubFile {
            filename: filename.to_string(),
            status: "modified".to_string(),
            additions,
            deletions,
            patch: patch.map(String::from),
        }
    }

    #[test]
    fn test_security_filename_match() {
        let files = vec![
            make_file("src/auth/login.rs", 10, 5, Some("+fn login()")),
            make_file("src/ui/button.tsx", 3, 1, Some("+<button>")),
        ];
        let result = triage_files(&files);
        let security = result.get(&AgentType::Security).unwrap();
        assert_eq!(security.primary.len(), 1);
        assert_eq!(security.primary[0].filename, "src/auth/login.rs");
    }

    #[test]
    fn test_security_content_match() {
        let files = vec![
            make_file("src/api/handler.rs", 5, 2, Some("+let token = get_bearer_token();")),
        ];
        let result = triage_files(&files);
        let security = result.get(&AgentType::Security).unwrap();
        assert_eq!(security.primary.len(), 1);
    }

    #[test]
    fn test_style_threshold() {
        let files = vec![
            make_file("src/main.rs", 3, 1, Some("+code")),  // 4 changes, below threshold
            make_file("src/lib.rs", 5, 0, Some("+code")),   // 5 changes, at threshold
        ];
        let result = triage_files(&files);
        let style = result.get(&AgentType::Style).unwrap();
        assert_eq!(style.primary.len(), 1);
        assert_eq!(style.primary[0].filename, "src/lib.rs");
    }

    #[test]
    fn test_file_can_be_primary_for_multiple_agents() {
        let files = vec![
            make_file("src/auth/service.rs", 20, 10, Some("+pub async fn authenticate(password: &str)")),
        ];
        let result = triage_files(&files);
        // Should be primary for security (auth filename + password content)
        assert!(!result.get(&AgentType::Security).unwrap().primary.is_empty());
        // Should be primary for architecture (service filename + pub fn)
        assert!(!result.get(&AgentType::Architecture).unwrap().primary.is_empty());
        // Should be primary for style (30 changes >= 5)
        assert!(!result.get(&AgentType::Style).unwrap().primary.is_empty());
        // Should be primary for performance (async keyword in diff)
        assert!(!result.get(&AgentType::Performance).unwrap().primary.is_empty());
    }
}
