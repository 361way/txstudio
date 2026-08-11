package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
)

// VOD 签名相关常量（与 vodAdapter.js 保持一致）
const (
	tc3Algorithm   = "TC3-HMAC-SHA256"
	tc3ContentType = "application/json; charset=utf-8"
	tc3SignedHeaders = "content-type;host;x-tc-action"
)

// VodSignedHeaders 腾讯云 VOD API 请求签名后的完整 headers
type VodSignedHeaders struct {
	Authorization   string
	ContentType     string
	Host            string
	XTCAction       string
	XTCTimestamp    string
	XTCVersion      string
	XTCRegion       string // 可空
}

// SignVodRequest 为一次腾讯云 VOD API 请求生成完整签名 headers。
// 移植自 src/vodAdapter.js:156-202 的 signVodRequest，仅适用于 POST JSON 请求（API 3.0）。
//
// 注意：timestamp 显式传入以便测试可复现；生产环境传 time.Now().Unix()。
func SignVodRequest(secretID, secretKey, action, version, region, service, host, payload string, timestamp int64) VodSignedHeaders {
	// UTC YYYY-MM-DD（与 JS new Date(ts*1000).toISOString().slice(0,10) 一致）
	date := time.Unix(timestamp, 0).UTC().Format("2006-01-02")
	body := payload // 已序列化的 JSON 字符串

	// 1) CanonicalRequest
	hashedPayload := sha256Hex(body)
	canonicalHeaders := fmt.Sprintf("content-type:%s\nhost:%s\nx-tc-action:%s\n",
		tc3ContentType, host, lowerASCII(action))
	canonicalRequest := joinStrings("\n",
		"POST", "/", "", canonicalHeaders, tc3SignedHeaders, hashedPayload)

	// 2) StringToSign
	credentialScope := fmt.Sprintf("%s/%s/tc3_request", date, service)
	hashedCanonical := sha256Hex(canonicalRequest)
	stringToSign := joinStrings("\n",
		tc3Algorithm, strconv.FormatInt(timestamp, 10), credentialScope, hashedCanonical)

	// 3) SecretSigning (chained HMAC；输入是 bytes，不是 hex)
	// JS: hmacSha256('TC3' + secretKey, date) — key 是字符串 'TC3'+secretKey 的 UTF-8 字节
	secretDate := hmacSha256([]byte("TC3"+secretKey), []byte(date))
	// JS: hmacSha256(secretDate, service) — key 是 secretDate 的原始字节（Uint8Array）
	secretService := hmacSha256(secretDate, []byte(service))
	// JS: hmacSha256(secretService, 'tc3_request')
	secretSigning := hmacSha256(secretService, []byte("tc3_request"))

	// 4) Signature
	sigBytes := hmacSha256(secretSigning, []byte(stringToSign))
	signature := hex.EncodeToString(sigBytes)

	authorization := fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		tc3Algorithm, secretID, credentialScope, tc3SignedHeaders, signature)

	h := VodSignedHeaders{
		Authorization: authorization,
		ContentType:   tc3ContentType,
		Host:          host,
		XTCAction:     action,
		XTCTimestamp:  strconv.FormatInt(timestamp, 10),
		XTCVersion:    version,
	}
	if region != "" {
		h.XTCRegion = region
	}
	return h
}

// sha256Hex 返回输入字符串的 SHA-256 十六进制摘要
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// hmacSha256 返回 HMAC-SHA256(key, msg) 的原始字节
func hmacSha256(key, msg []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(msg)
	return mac.Sum(nil)
}

// lowerASCII 将 ASCII 字符串转小写（与 JS String.toLowerCase 对 ASCII 范围一致）
func lowerASCII(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

// joinStrings 用 sep 拼接多段字符串（对应 JS 的 Array.join('\n')）
func joinStrings(sep string, parts ...string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}
