use std::fs;
use std::path::Path;

fn main() {
    // Load .env file from project root and expose values as compile-time env vars
    let env_path = Path::new("../.env");
    if env_path.exists() {
        let contents = fs::read_to_string(env_path).expect("Failed to read .env file");
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim().trim_matches('"').trim_matches('\'');
                println!("cargo:rustc-env={key}={value}");
            }
        }
        println!("cargo:rerun-if-changed=../.env");
    } else {
        // Ensure these are set in the environment when no .env file exists
        for key in ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] {
            if std::env::var(key).is_err() {
                panic!(
                    "Missing {key}. Create a .env file in the project root or set it in the environment."
                );
            }
        }
    }

    tauri_build::build()
}
