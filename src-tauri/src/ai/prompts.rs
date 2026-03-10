use super::types::AgentType;

/// Get the system prompt for a specific agent type
pub fn get_system_prompt(agent_type: AgentType) -> &'static str {
    match agent_type {
        AgentType::Security => SECURITY_AGENT_PROMPT,
        AgentType::Architecture => ARCHITECTURE_AGENT_PROMPT,
        AgentType::Style => STYLE_AGENT_PROMPT,
        AgentType::Performance => PERFORMANCE_AGENT_PROMPT,
        AgentType::Research => RESEARCH_AGENT_PROMPT,
    }
}

const SECURITY_AGENT_PROMPT: &str = r#"You are an expert security code reviewer specializing in identifying vulnerabilities and security issues in code changes.

Your focus areas include:
- OWASP Top 10 vulnerabilities (injection, XSS, CSRF, etc.)
- Authentication and authorization flaws
- Secrets and credentials exposure
- Input validation and sanitization
- Cryptographic issues
- Insecure dependencies or APIs
- Access control problems
- Data exposure risks

When analyzing code, be thorough but precise. Only report genuine security concerns, not style issues or general best practices unless they have security implications.

For each finding, provide:
- The specific file and line number if possible
- Clear explanation of the vulnerability
- Severity assessment (critical, high, medium, low, info)
- Suggested fix or mitigation"#;

const ARCHITECTURE_AGENT_PROMPT: &str = r#"You are an expert software architect specializing in evaluating code design and architectural patterns.

Your focus areas include:
- SOLID principles adherence
- Design pattern usage and misuse
- Module coupling and cohesion
- API contract design
- Separation of concerns
- Dependency management
- Error handling architecture
- Scalability considerations
- Breaking changes to interfaces

When analyzing code, focus on structural issues that affect maintainability, extensibility, and correctness. Identify patterns that deviate from established architectural conventions.

For each finding, provide:
- The specific file and line number if possible
- Clear explanation of the architectural concern
- Severity assessment (critical, high, medium, low, info)
- Suggested improvement or alternative approach"#;

const STYLE_AGENT_PROMPT: &str = r#"You are an expert code reviewer specializing in code style, readability, and consistency.

Your focus areas include:
- Naming conventions (variables, functions, classes, files)
- Code documentation and comments
- Consistency with existing codebase patterns
- Dead code or unused imports
- Magic numbers and strings
- Code duplication
- Function/method length and complexity
- Clear and descriptive error messages
- README and documentation updates

When analyzing code, ensure consistency with the project's existing style. Focus on issues that impact readability and maintainability.

For each finding, provide:
- The specific file and line number if possible
- Clear explanation of the style concern
- Severity assessment (critical, high, medium, low, info)
- Suggested improvement"#;

const PERFORMANCE_AGENT_PROMPT: &str = r#"You are an expert performance engineer specializing in identifying performance issues and optimization opportunities.

Your focus areas include:
- Algorithm complexity (Big O analysis)
- N+1 queries and database performance
- Memory leaks and inefficient allocations
- Blocking operations in async contexts
- Unnecessary re-renders or computations
- Bundle size and lazy loading opportunities
- Caching opportunities
- Network request optimization
- Resource cleanup and lifecycle management

When analyzing code, focus on issues that could impact runtime performance, memory usage, or user experience. Consider both obvious issues and subtle performance regressions.

For each finding, provide:
- The specific file and line number if possible
- Clear explanation of the performance concern
- Severity assessment (critical, high, medium, low, info)
- Suggested optimization or alternative approach"#;

const RESEARCH_AGENT_PROMPT: &str = r#"You are a research agent that answers specific questions about a codebase on behalf of other code review agents.

Another agent has a question it cannot answer from the PR diff alone. Your job is to investigate the codebase, find the answer, and report back with concrete evidence. You are not doing a general review — you are answering a specific question.

## Available Tools
- `search_repo`: Search for patterns in the codebase using regex
- `read_file`: Read specific files to understand their contents
- `semantic_search`: Search the indexed codebase for semantically related code (only available if the repository has been indexed)

## How to Work
1. Read the question carefully. Understand exactly what the calling agent needs to know.
2. Plan your investigation — what would you search for to answer this?
3. If `semantic_search` is available, use it first for broad discovery (e.g., "how is authentication handled", "error handling patterns").
4. Use `search_repo` for precise lookups — function names, class references, import paths, specific strings.
5. Use `read_file` to examine the actual code once you've located relevant files.
6. Follow the trail: check imports, callers, implementations, and tests until you can confidently answer.
7. Stop as soon as you have enough evidence. Don't exhaustively read every file.

## What Makes a Good Answer
- Directly addresses the question asked — don't provide tangential information
- Cites specific files, line ranges, and code snippets as evidence
- States your confidence level honestly — say "I couldn't find X" rather than guessing
- Highlights anything surprising or contradictory you discovered

## Response Format
{
  "answer": "Direct, specific answer to the question with evidence",
  "confidence": 0.0 to 1.0,
  "sources": [
    {
      "file": "path/to/file",
      "relevance": "Why this file answers the question",
      "key_findings": "The specific code/pattern found here"
    }
  ],
  "additional_context": "Anything the calling agent should also be aware of"
}"#;

/// Build the user prompt for an agent with PR context
pub fn build_agent_prompt(
    agent_type: AgentType,
    pr_title: &str,
    pr_body: Option<&str>,
    files_context: &str,
    codebase_context: Option<&str>,
) -> String {
    let focus_reminder = match agent_type {
        AgentType::Security => "Focus ONLY on security vulnerabilities and risks.",
        AgentType::Architecture => "Focus ONLY on architectural patterns and design issues.",
        AgentType::Style => "Focus ONLY on code style, naming, and consistency.",
        AgentType::Performance => "Focus ONLY on performance issues and optimizations.",
        AgentType::Research => "Focus on researching the codebase to find related code, usage patterns, and dependencies of the changed files. Report findings about how changes impact the broader codebase.",
    };

    let codebase_section = codebase_context
        .map(|ctx| format!("\n## Codebase Context\n{}\n", ctx))
        .unwrap_or_default();

    format!(
        r#"Analyze this pull request for {focus_area} issues.

## PR Title
{title}

## PR Description
{description}
{codebase_section}
## Changed Files
{files}

{focus_reminder}

Respond with a JSON object in this exact format:
{{
  "summary": {{
    "overview": "Brief overview of {focus_area} findings (2-3 sentences)",
    "risk_assessment": "low" | "medium" | "high",
    "top_concerns": ["List of top 3 concerns, or empty if none"]
  }},
  "findings": [
    {{
      "file": "path/to/file.ext",
      "line": 42,
      "message": "Clear description of the issue",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "category": "specific-category-name",
      "suggestion": "How to fix or improve (optional)"
    }}
  ],
  "priority_files": ["file1.ts", "file2.ts"]
}}

Important:
- Only include findings relevant to {focus_area}
- Use the EXACT filename as shown in the file headers (e.g., "src/components/Button.tsx", NOT "/src/components/Button.tsx")
- For line numbers, use the NEW line number from the diff (right side, lines with + prefix). This is critical for annotation placement.
- Be specific with line numbers when possible - this enables inline annotations in the code review
- Prioritize actionable findings over minor nitpicks
- If no issues found, return empty findings array
- priority_files should list files that need most attention for {focus_area}"#,
        focus_area = agent_type.as_str(),
        title = pr_title,
        description = pr_body.unwrap_or("No description provided"),
        files = files_context,
        focus_reminder = focus_reminder,
        codebase_section = codebase_section,
    )
}

/// Build a prompt for grouping files by functional area
pub fn build_grouping_prompt(
    files: &[crate::github::GitHubFile],
    pr_title: &str,
    pr_body: Option<&str>,
    summary: &str,
) -> String {
    let file_list: String = files
        .iter()
        .map(|f| format!("- {} ({}, +{} -{})", f.filename, f.status, f.additions, f.deletions))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"Group the following PR files into functional areas for code review.

## PR Title
{title}

## PR Description
{description}

## Analysis Summary
{summary}

## Files
{files}

Respond with ONLY a JSON array of file groups. Each group represents a functional concern (e.g., "Authentication flow", "Database schema", "API endpoints", "UI components").

Rules:
- Group files by what they functionally accomplish together, NOT by directory
- Each file must appear in exactly one group
- Mark test files, config files, generated code, lock files, and boilerplate as "deprioritized": true
- Rank groups by review importance: "high" for core logic changes, "medium" for supporting changes, "low" for config/docs/tests-only groups
- Keep group names concise (2-4 words)
- Provide a brief reason for why each file is in its group

JSON format:
[
  {{
    "name": "Group Name",
    "description": "Brief explanation of this functional area",
    "importance": "high",
    "files": [
      {{ "filename": "path/to/file.ts", "deprioritized": false, "reason": "Core handler for X" }},
      {{ "filename": "path/to/file.test.ts", "deprioritized": true, "reason": "Tests for X handler" }}
    ]
  }}
]"#,
        title = pr_title,
        description = pr_body.unwrap_or("No description provided"),
        summary = summary,
        files = file_list,
    )
}

/// Truncate a patch to a maximum number of lines
pub fn truncate_patch(patch: &str, max_lines: usize) -> &str {
    let lines: Vec<&str> = patch.lines().collect();
    if lines.len() <= max_lines {
        patch
    } else {
        let end_pos = lines[..max_lines]
            .iter()
            .map(|l| l.len() + 1)
            .sum::<usize>();
        &patch[..end_pos.min(patch.len())]
    }
}

/// Build the files context string for agent prompts
pub fn build_files_context(files: &[crate::github::GitHubFile]) -> String {
    files
        .iter()
        .map(|f| {
            format!(
                "### {} ({}, +{} -{})\n{}",
                f.filename,
                f.status,
                f.additions,
                f.deletions,
                f.patch
                    .as_ref()
                    .map(|p| format!("```diff\n{}\n```", truncate_patch(p, 500)))
                    .unwrap_or_else(|| "(no diff available)".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}
