package service

import (
	"encoding/hex"
	"testing"
)

// Golden vector 与 /tmp/capture_golden_vector.mjs 的 JS signVodRequest 输出逐字节对齐。
// 验证 TC3-HMAC-SHA256 移植的正确性。任何输出不一致都会破坏所有 VOD 调用。
func TestSignVodRequest_GoldenVector(t *testing.T) {
	const (
		secretID    = "AKIDtest1234567890abcdef"
		secretKey   = "test-secret-key-for-golden-vector-123456"
		action      = "CreateAigcImageTask"
		version     = "2018-07-17"
		region      = "ap-guangzhou"
		service     = "vod"
		host        = "vod.tencentcloudapi.com"
		timestamp   = int64(1717200000)
		payload     = `{"ModelName":"Kling","ModelVersion":"3.0","Prompt":"a cat"}`
		expectedDate = "2024-06-01"
	)

	_ = expectedDate // 仅作文档；date 由 timestamp 推导，下面间接校验

	// 先校验中间值（定位漂移点）
	hashedPayload := sha256Hex(payload)
	if want := "8d491b3e05a39ae15aa5a23c18f4405acf7ee84ff75232571bfa8b4b218428e3"; hashedPayload != want {
		t.Errorf("hashedPayload mismatch:\n got %s\nwant %s", hashedPayload, want)
	}

	canonicalHeaders := "content-type:application/json; charset=utf-8\nhost:vod.tencentcloudapi.com\nx-tc-action:createaigcimagetask\n"
	canonicalRequest := "POST\n/\n\n" + canonicalHeaders + "\ncontent-type;host;x-tc-action\n" + hashedPayload
	wantCanonical := "POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:vod.tencentcloudapi.com\nx-tc-action:createaigcimagetask\n\ncontent-type;host;x-tc-action\n8d491b3e05a39ae15aa5a23c18f4405acf7ee84ff75232571bfa8b4b218428e3"
	if canonicalRequest != wantCanonical {
		t.Errorf("canonicalRequest mismatch:\n got %q\nwant %q", canonicalRequest, wantCanonical)
	}

	hashedCanonical := sha256Hex(canonicalRequest)
	if want := "025e09116415451334bcc44c2d38eb2e8a02fcdc7b309b26dab94d04a7629be1"; hashedCanonical != want {
		t.Errorf("hashedCanonical mismatch:\n got %s\nwant %s", hashedCanonical, want)
	}

	// 链式 HMAC 中间值
	secretDate := hmacSha256([]byte("TC3"+secretKey), []byte("2024-06-01"))
	if got := hex.EncodeToString(secretDate); got != "765b839d73435885439a001d9d247eef5b50c3b3f587e962c05755d2b5131839" {
		t.Errorf("secretDate mismatch: got %s", got)
	}
	secretService := hmacSha256(secretDate, []byte(service))
	if got := hex.EncodeToString(secretService); got != "8edb59341c806356d5080c2e4545da0fe47321eadcc3efab2ac7a9fff4944891" {
		t.Errorf("secretService mismatch: got %s", got)
	}
	secretSigning := hmacSha256(secretService, []byte("tc3_request"))
	if got := hex.EncodeToString(secretSigning); got != "a30fb2a34141c3437aca6986227cdbe682db7aaec91b3a6ff44a1494d81824cb" {
		t.Errorf("secretSigning mismatch: got %s", got)
	}

	// 完整签名
	h := SignVodRequest(secretID, secretKey, action, version, region, service, host, payload, timestamp)

	wantSig := "c35664e7b21a00a4ea853963e73cd431a1b12e041bfafa83dc293cd07fd8edbb"
	wantAuth := "TC3-HMAC-SHA256 Credential=AKIDtest1234567890abcdef/2024-06-01/vod/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=" + wantSig
	if h.Authorization != wantAuth {
		t.Errorf("Authorization mismatch:\n got %s\nwant %s", h.Authorization, wantAuth)
	}
	if h.XTCTimestamp != "1717200000" {
		t.Errorf("XTCTimestamp mismatch: got %s", h.XTCTimestamp)
	}
	if h.XTCAction != "CreateAigcImageTask" {
		t.Errorf("XTCAction mismatch: got %s", h.XTCAction)
	}
	if h.XTCVersion != "2018-07-17" {
		t.Errorf("XTCVersion mismatch: got %s", h.XTCVersion)
	}
	if h.XTCRegion != "ap-guangzhou" {
		t.Errorf("XTCRegion mismatch: got %s", h.XTCRegion)
	}
	if h.Host != "vod.tencentcloudapi.com" {
		t.Errorf("Host mismatch: got %s", h.Host)
	}
	if h.ContentType != "application/json; charset=utf-8" {
		t.Errorf("ContentType mismatch: got %s", h.ContentType)
	}
}

// 无 region 时 XTCRegion 应为空
func TestSignVodRequest_NoRegion(t *testing.T) {
	h := SignVodRequest("id", "key", "DescribeTaskDetail", "2018-07-17", "", "vod", "vod.tencentcloudapi.com", "{}", 1717200000)
	if h.XTCRegion != "" {
		t.Errorf("XTCRegion should be empty, got %s", h.XTCRegion)
	}
}
