use super::*;

impl Orchestrator {
    pub(super) fn aggregate_responses(
        &self,
        responses: &[AgentResponse],
        failed_agents: &[FailedAgent],
        files: &[GitHubFile],
        total_time_ms: u64,
    ) -> OrchestratedAnalysis {
        // Calculate overall risk level
        let risk_level = self.calculate_risk_level(responses);

        // Build summary from agent summaries
        let summary = self.build_summary(responses);

        // Calculate file priorities
        let file_priorities = self.calculate_file_priorities(responses, files);

        // Build per-file analyses with annotations
        let file_analyses = self.build_file_analyses(responses, files);

        // Build categories from findings
        let categories = self.build_categories(responses, files);

        // Build key changes
        let key_changes = self.build_key_changes(responses);

        // Suggested review order based on priorities
        let suggested_review_order: Vec<String> = file_priorities
            .iter()
            .take(10)
            .map(|fp| fp.filename.clone())
            .collect();

        // Calculate total token usage across all agents
        let total_token_usage = responses.iter().fold(
            TokenUsage::default(),
            |acc, r| {
                if let Some(usage) = &r.token_usage {
                    TokenUsage {
                        prompt_tokens: acc.prompt_tokens + usage.prompt_tokens,
                        completion_tokens: acc.completion_tokens + usage.completion_tokens,
                        total_tokens: acc.total_tokens + usage.total_tokens,
                    }
                } else {
                    acc
                }
            },
        );

        OrchestratedAnalysis {
            summary,
            risk_level,
            file_priorities,
            file_analyses,
            categories,
            key_changes,
            suggested_review_order,
            agent_responses: responses.to_vec(),
            failed_agents: failed_agents.to_vec(),
            total_processing_time_ms: total_time_ms,
            total_token_usage,
            file_groups: Vec::new(), // Populated by caller after grouping
            diagnostics: DiagnosticLog::default(),
        }
    }

    fn calculate_risk_level(&self, responses: &[AgentResponse]) -> String {
        let mut high_count = 0;
        let mut medium_count = 0;

        for response in responses {
            match response.summary.risk_assessment.to_lowercase().as_str() {
                "high" => high_count += 1,
                "medium" => medium_count += 1,
                _ => {}
            }

            // Also consider critical/high severity findings
            for finding in &response.findings {
                match finding.severity {
                    Severity::Critical => high_count += 2,
                    Severity::High => high_count += 1,
                    _ => {}
                }
            }
        }

        if high_count >= 2 {
            "high".to_string()
        } else if high_count >= 1 || medium_count >= 2 {
            "medium".to_string()
        } else {
            "low".to_string()
        }
    }

    fn build_summary(&self, responses: &[AgentResponse]) -> String {
        let mut summaries: Vec<String> = Vec::new();

        for response in responses {
            if !response.summary.overview.is_empty() {
                summaries.push(format!(
                    "**{}**: {}",
                    capitalize(response.agent_type.as_str()),
                    response.summary.overview
                ));
            }
        }

        if summaries.is_empty() {
            "No significant issues found.".to_string()
        } else {
            summaries.join("\n\n")
        }
    }

    fn calculate_file_priorities(
        &self,
        responses: &[AgentResponse],
        files: &[GitHubFile],
    ) -> Vec<FilePriority> {
        let mut file_scores: HashMap<String, (u8, Vec<String>)> = HashMap::new();
        let actual_filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();

        // Initialize with all files
        for file in files {
            file_scores.insert(file.filename.clone(), (0, Vec::new()));
        }

        // Add scores from findings
        for response in responses {
            let agent_name = capitalize(response.agent_type.as_str());

            for finding in &response.findings {
                // Fuzzy-match to actual filename
                let matched = fuzzy_match_filename(&finding.file, &actual_filenames)
                    .unwrap_or(&finding.file);

                let entry = file_scores
                    .entry(matched.to_string())
                    .or_insert((0, Vec::new()));

                let severity_score = finding.severity.priority() * 2;
                entry.0 = entry.0.saturating_add(severity_score);
                entry.1.push(format!(
                    "{}: {} ({})",
                    agent_name,
                    finding.category,
                    format!("{:?}", finding.severity).to_lowercase()
                ));
            }

            // Add scores for priority files
            for priority_file in &response.priority_files {
                let matched = fuzzy_match_filename(priority_file, &actual_filenames)
                    .unwrap_or(priority_file);

                let entry = file_scores
                    .entry(matched.to_string())
                    .or_insert((0, Vec::new()));
                entry.0 = entry.0.saturating_add(3);
                entry.1.push(format!("{}: Priority file", agent_name));
            }
        }

        // Convert to sorted list
        let mut priorities: Vec<FilePriority> = file_scores
            .into_iter()
            .map(|(filename, (score, reasons))| FilePriority {
                filename,
                priority_score: score,
                reasons,
            })
            .collect();

        priorities.sort_by(|a, b| b.priority_score.cmp(&a.priority_score));
        priorities
    }

    fn build_file_analyses(
        &self,
        responses: &[AgentResponse],
        files: &[GitHubFile],
    ) -> Vec<FileAnalysis> {
        let mut file_map: HashMap<String, FileAnalysis> = HashMap::new();

        // Initialize with all files
        for file in files {
            file_map.insert(
                file.filename.clone(),
                FileAnalysis {
                    filename: file.filename.clone(),
                    importance_score: 0,
                    annotations: Vec::new(),
                    context: FileContext {
                        summary: String::new(),
                        purpose: String::new(),
                        related_files: Vec::new(),
                    },
                    agent_findings: Vec::new(),
                },
            );
        }

        // Collect actual filenames for fuzzy matching
        let actual_filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();

        // Add findings as annotations
        for response in responses {
            for finding in &response.findings {
                // Fuzzy-match AI-reported filename to actual PR files
                let file_key = fuzzy_match_filename(&finding.file, &actual_filenames)
                    .map(|s| s.to_string());

                if let Some(key) = file_key {
                    if let Some(analysis) = file_map.get_mut(&key) {
                    // Add to agent findings
                    analysis.agent_findings.push(finding.clone());

                    // Add annotation if line number exists
                    if let Some(line) = finding.line {
                        analysis.annotations.push(LineAnnotation {
                            line_number: line,
                            row_index: None, // Will be mapped by frontend
                            annotation_type: severity_to_annotation_type(&finding.severity),
                            message: finding.message.clone(),
                            sources: vec![response.agent_type],
                            severity: finding.severity,
                            category: finding.category.clone(),
                            suggestion: finding.suggestion.clone(),
                        });
                    }

                    // Update importance score
                    analysis.importance_score = analysis
                        .importance_score
                        .saturating_add(finding.severity.priority());
                    }
                }
            }
        }

        // Merge duplicate annotations on same line
        for analysis in file_map.values_mut() {
            analysis.annotations = merge_annotations(&analysis.annotations);
        }

        let mut analyses: Vec<FileAnalysis> = file_map.into_values().collect();
        analyses.sort_by(|a, b| b.importance_score.cmp(&a.importance_score));
        analyses
    }

    fn build_categories(&self, responses: &[AgentResponse], files: &[GitHubFile]) -> Vec<PRCategory> {
        let mut categories: HashMap<String, Vec<String>> = HashMap::new();
        let actual_filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();

        // Group files by agent concerns
        for response in responses {
            let agent_name = capitalize(response.agent_type.as_str());

            if !response.findings.is_empty() {
                let files_with_findings: Vec<String> = response
                    .findings
                    .iter()
                    .map(|f| fuzzy_match_filename(&f.file, &actual_filenames)
                        .unwrap_or(&f.file)
                        .to_string())
                    .collect::<std::collections::HashSet<_>>()
                    .into_iter()
                    .collect();

                categories.insert(
                    format!("{} Concerns", agent_name),
                    files_with_findings,
                );
            }
        }

        // Add uncategorized files
        let all_flagged_files: std::collections::HashSet<String> = categories
            .values()
            .flatten()
            .cloned()
            .collect();

        let other_files: Vec<String> = files
            .iter()
            .map(|f| f.filename.clone())
            .filter(|f| !all_flagged_files.contains(f))
            .collect();

        if !other_files.is_empty() {
            categories.insert("Other Changes".to_string(), other_files);
        }

        categories
            .into_iter()
            .map(|(name, files)| PRCategory {
                name: name.clone(),
                description: get_category_description(&name),
                files,
            })
            .collect()
    }

    fn build_key_changes(&self, responses: &[AgentResponse]) -> Vec<KeyChange> {
        let mut key_changes: Vec<KeyChange> = Vec::new();

        for response in responses {
            for finding in &response.findings {
                if matches!(finding.severity, Severity::Critical | Severity::High) {
                    key_changes.push(KeyChange {
                        file: finding.file.clone(),
                        line: finding.line.map(|l| l as i64),
                        description: finding.message.clone(),
                        importance: format!("{:?}", finding.severity).to_lowercase(),
                    });
                }
            }
        }

        // Limit to top 10
        key_changes.truncate(10);
        key_changes
    }
}

fn severity_to_annotation_type(severity: &Severity) -> AnnotationType {
    match severity {
        Severity::Critical | Severity::High => AnnotationType::Warning,
        Severity::Medium | Severity::Low => AnnotationType::Info,
        Severity::Info => AnnotationType::Suggestion,
    }
}

fn merge_annotations(annotations: &[LineAnnotation]) -> Vec<LineAnnotation> {
    let mut by_line: HashMap<u32, LineAnnotation> = HashMap::new();

    for ann in annotations {
        if let Some(existing) = by_line.get_mut(&ann.line_number) {
            // Merge sources
            for source in &ann.sources {
                if !existing.sources.contains(source) {
                    existing.sources.push(*source);
                }
            }
            // Keep higher severity
            if ann.severity.priority() > existing.severity.priority() {
                existing.severity = ann.severity;
                existing.annotation_type = ann.annotation_type.clone();
            }
            // Combine messages
            existing.message = format!("{}\n\n{}", existing.message, ann.message);
        } else {
            by_line.insert(ann.line_number, ann.clone());
        }
    }

    by_line.into_values().collect()
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().chain(chars).collect(),
    }
}

fn get_category_description(name: &str) -> String {
    match name {
        "Security Concerns" => "Files with potential security vulnerabilities".to_string(),
        "Architecture Concerns" => "Files with architectural or design issues".to_string(),
        "Style Concerns" => "Files with style or consistency issues".to_string(),
        "Performance Concerns" => "Files with potential performance issues".to_string(),
        "Other Changes" => "Files without specific concerns flagged".to_string(),
        _ => "".to_string(),
    }
}

/// Fuzzy-match an AI-reported filename against the actual PR file list.
/// Tries in order: exact match, normalized match (strip leading /, normalize \),
/// suffix match (AI might omit a prefix), basename match (last resort).
pub(super) fn fuzzy_match_filename<'a>(ai_name: &str, actual_names: &[&'a str]) -> Option<&'a str> {
    // 1. Exact match
    if let Some(&exact) = actual_names.iter().find(|&&n| n == ai_name) {
        return Some(exact);
    }

    let normalized = ai_name.trim_start_matches('/').replace('\\', "/");

    // 2. Normalized match
    if let Some(&m) = actual_names.iter().find(|&&n| {
        n.trim_start_matches('/').replace('\\', "/") == normalized
    }) {
        return Some(m);
    }

    // 3. Suffix match — AI might report "src/foo.ts" when actual is "packages/app/src/foo.ts"
    //    or vice versa
    let suffix_matches: Vec<&&str> = actual_names.iter()
        .filter(|&&n| n.ends_with(&format!("/{}", normalized)) || normalized.ends_with(&format!("/{}", n)))
        .collect();
    if suffix_matches.len() == 1 {
        return Some(suffix_matches[0]);
    }

    // 4. Basename match — only if unambiguous
    let ai_basename = normalized.rsplit('/').next().unwrap_or(&normalized);
    let basename_matches: Vec<&&str> = actual_names.iter()
        .filter(|&&n| {
            let base = n.rsplit('/').next().unwrap_or(n);
            base == ai_basename
        })
        .collect();
    if basename_matches.len() == 1 {
        return Some(basename_matches[0]);
    }

    None // Couldn't match
}
