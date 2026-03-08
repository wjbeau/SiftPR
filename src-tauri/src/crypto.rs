use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::Rng;

use crate::error::{AppError, AppResult};

const NONCE_SIZE: usize = 12;

/// Get or generate encryption key
/// In production, this should be stored securely (e.g., macOS Keychain)
fn get_encryption_key() -> AppResult<[u8; 32]> {
    // For now, use a deterministic key derived from app identifier
    // TODO: Use keyring crate for proper secure storage
    let key_material = "reviewboss-encryption-key-v1";
    let mut key = [0u8; 32];

    // Simple key derivation (in production, use proper KDF)
    for (i, byte) in key_material.bytes().cycle().take(32).enumerate() {
        key[i] = byte;
    }

    Ok(key)
}

/// Encrypt a string value
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

/// Decrypt a string value
pub fn decrypt(encrypted: &str) -> AppResult<String> {
    let key = get_encryption_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    let combined = STANDARD
        .decode(encrypted)
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    if combined.len() < NONCE_SIZE {
        return Err(AppError::Encryption("Invalid encrypted data".to_string()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Encryption(e.to_string()))?;

    String::from_utf8(plaintext).map_err(|e| AppError::Encryption(e.to_string()))
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
}
