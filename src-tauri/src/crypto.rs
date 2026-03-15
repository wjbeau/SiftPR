//! Cryptographic utilities for secure data storage
//!
//! This module handles encryption/decryption of sensitive data (API keys, tokens)
//! using AES-256-GCM with a key stored in a file in the app data directory.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::Rng;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};

const NONCE_SIZE: usize = 12;

/// Legacy key material for migration purposes only.
/// This was the old insecure key - kept only to decrypt existing data.
/// NOTE: This must match the ORIGINAL key that was used to encrypt existing data.
const LEGACY_KEY_MATERIAL: &str = "reviewboss-encryption-key-v1";

/// Get the path to the encryption key file in the app data directory.
fn key_file_path() -> AppResult<PathBuf> {
    let data_dir = dirs::data_dir()
        .ok_or_else(|| AppError::Encryption("Cannot find data directory".into()))?;
    Ok(data_dir.join("SiftPR").join("encryption.key"))
}

/// Write the key to the key file with restricted permissions.
fn write_key_file(path: &PathBuf, key: &[u8; 32]) -> AppResult<()> {
    let key_b64 = STANDARD.encode(key);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Encryption(format!("Failed to create key directory: {}", e)))?;
    }

    std::fs::write(path, key_b64.as_bytes())
        .map_err(|e| AppError::Encryption(format!("Failed to write key file: {}", e)))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| AppError::Encryption(format!("Failed to set key file permissions: {}", e)))?;
    }

    Ok(())
}

/// Read the key from the key file.
fn read_key_file(path: &PathBuf) -> AppResult<Option<[u8; 32]>> {
    match std::fs::read_to_string(path) {
        Ok(key_b64) => {
            let key_bytes = STANDARD
                .decode(key_b64.trim())
                .map_err(|e| AppError::Encryption(format!("Invalid key format: {}", e)))?;

            if key_bytes.len() != 32 {
                return Err(AppError::Encryption("Invalid key length".to_string()));
            }

            let mut key = [0u8; 32];
            key.copy_from_slice(&key_bytes);
            Ok(Some(key))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Encryption(format!("Failed to read key file: {}", e))),
    }
}

/// Get the encryption key from a file in the app data directory.
/// If no key exists, generates a new one.
fn get_encryption_key() -> AppResult<[u8; 32]> {
    let path = key_file_path()?;

    if let Some(key) = read_key_file(&path)? {
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill(&mut key);
    write_key_file(&path, &key)?;

    Ok(key)
}

/// Get the legacy encryption key (for migration only).
/// This uses the old insecure key derivation method.
fn get_legacy_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    for (i, byte) in LEGACY_KEY_MATERIAL.bytes().cycle().take(32).enumerate() {
        key[i] = byte;
    }
    key
}

/// Encrypt a string value using the secure key
pub fn encrypt(plaintext: &str) -> AppResult<String> {
    let key = get_encryption_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::thread_rng().fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    // Combine nonce + ciphertext
    let mut combined = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(STANDARD.encode(&combined))
}

/// Decrypt a string value using the secure key.
/// Falls back to legacy key for migration if decryption fails.
pub fn decrypt(encrypted: &str) -> AppResult<String> {
    let combined = STANDARD
        .decode(encrypted)
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    if combined.len() < NONCE_SIZE {
        return Err(AppError::Encryption("Invalid encrypted data".to_string()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);

    // Try with secure key first
    let key = get_encryption_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    match cipher.decrypt(nonce, ciphertext) {
        Ok(plaintext) => {
            String::from_utf8(plaintext).map_err(|e| AppError::Encryption(e.to_string()))
        }
        Err(_) => {
            // Try with legacy key for migration
            let legacy_key = get_legacy_key();
            let legacy_cipher = Aes256Gcm::new_from_slice(&legacy_key)
                .map_err(|e| AppError::Encryption(e.to_string()))?;

            let plaintext = legacy_cipher
                .decrypt(nonce, ciphertext)
                .map_err(|e| AppError::Encryption(format!("Decryption failed: {}", e)))?;

            String::from_utf8(plaintext).map_err(|e| AppError::Encryption(e.to_string()))
        }
    }
}

/// Check if data was encrypted with the legacy key and needs migration.
/// Returns the decrypted value if migration is needed, None otherwise.
pub fn check_needs_migration(encrypted: &str) -> Option<String> {
    let combined = STANDARD.decode(encrypted).ok()?;

    if combined.len() < NONCE_SIZE {
        return None;
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);

    // Try with secure key first
    if let Ok(key) = get_encryption_key() {
        let cipher = Aes256Gcm::new_from_slice(&key).ok()?;
        if cipher.decrypt(nonce, ciphertext).is_ok() {
            // Already using secure key, no migration needed
            return None;
        }
    }

    // Try with legacy key
    let legacy_key = get_legacy_key();
    let legacy_cipher = Aes256Gcm::new_from_slice(&legacy_key).ok()?;

    let plaintext = legacy_cipher.decrypt(nonce, ciphertext).ok()?;
    String::from_utf8(plaintext).ok()
}

/// Re-encrypt data from legacy key to secure key.
/// Returns the newly encrypted value.
pub fn migrate_to_secure_key(plaintext: &str) -> AppResult<String> {
    encrypt(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let original = "sk-test-api-key-12345";
        let encrypted = encrypt(original).unwrap();
        let decrypted = decrypt(&encrypted).unwrap();
        assert_eq!(original, decrypted);
    }

    #[test]
    fn test_different_encryptions_are_different() {
        let original = "same-key";
        let encrypted1 = encrypt(original).unwrap();
        let encrypted2 = encrypt(original).unwrap();
        // Due to random nonce, encryptions should differ
        assert_ne!(encrypted1, encrypted2);
        // But both should decrypt to the same value
        assert_eq!(decrypt(&encrypted1).unwrap(), original);
        assert_eq!(decrypt(&encrypted2).unwrap(), original);
    }
}
