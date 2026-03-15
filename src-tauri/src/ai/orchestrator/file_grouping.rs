use super::*;
use super::aggregator::fuzzy_match_filename;

impl Orchestrator {
    pub(super) async fn run_file_grouping(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
        files: &[GitHubFile],
        pr_title: &str,
        pr_body: Option<&str>,
        summary: &str,
    ) -> AppResult<Vec<FileGroup>> {
        let prompt = build_grouping_prompt(files, pr_title, pr_body, summary);
        let system = "You are a code review assistant. Respond with ONLY valid JSON, no markdown fences or explanation.";

        let ai_response = self.client.call_with_system(provider, api_key, model, system, &prompt).await?;

        let mut groups: Vec<FileGroup> = super::super::json_extract::extract_json(&ai_response.content)
            .map_err(|e| AppError::AIProvider(format!("Failed to parse file groups: {}", e)))?;

        // Reconcile AI-reported filenames with actual PR filenames
        self.reconcile_group_filenames(&mut groups, files);

        Ok(groups)
    }

    /// Match AI-reported filenames to actual PR filenames using fuzzy matching.
    /// The AI often returns slightly different paths (leading slash, different casing, etc.)
    pub(super) fn reconcile_group_filenames(&self, groups: &mut [FileGroup], files: &[GitHubFile]) {
        let actual_filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();

        for group in groups.iter_mut() {
            for gf in group.files.iter_mut() {
                if let Some(matched) = fuzzy_match_filename(&gf.filename, &actual_filenames) {
                    if matched != gf.filename {
                        println!("[AI] Filename reconciled: '{}' -> '{}'", gf.filename, matched);
                        gf.filename = matched.to_string();
                    }
                }
            }
        }
    }
}
