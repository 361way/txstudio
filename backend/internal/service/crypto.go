package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
)

// CryptoService AES-256-GCM 加密/解密，用于凭证安全存储
type CryptoService struct {
	key []byte // 32 字节
}

// NewCryptoService 从 hex 字符串创建加密服务
func NewCryptoService(hexKey string) (*CryptoService, error) {
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, errors.New("AES 密钥不是合法的 hex 字符串")
	}
	if len(key) != 32 {
		return nil, errors.New("AES 密钥必须为 32 字节")
	}
	return &CryptoService{key: key}, nil
}

// Encrypt 加密明文，返回 base64 密文（含 nonce）
func (s *CryptoService) Encrypt(plaintext []byte) (string, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	// nonce 拼在密文前面
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return hex.EncodeToString(ciphertext), nil
}

// Decrypt 解密 Encrypt 产出的密文
func (s *CryptoService) Decrypt(encoded string) ([]byte, error) {
	ciphertext, err := hex.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < gcm.NonceSize() {
		return nil, errors.New("ciphertext too short")
	}
	nonce := ciphertext[:gcm.NonceSize()]
	data := ciphertext[gcm.NonceSize():]
	return gcm.Open(nil, nonce, data, nil)
}
