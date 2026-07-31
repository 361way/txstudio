package handler

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestUpstreamJSONFieldsTencentCloud(t *testing.T) {
	body := []byte(`{"Response":{"Error":{"Code":"InvalidParameter","Message":"bad request"},"RequestId":"6fb1b2c3-d4e5-6789-abcd-ef0123456789"}}`)
	requestID, errorCode := upstreamJSONFields(body)
	if requestID != "6fb1b2c3-d4e5-6789-abcd-ef0123456789" {
		t.Fatalf("requestID = %q", requestID)
	}
	if errorCode != "InvalidParameter" {
		t.Fatalf("errorCode = %q", errorCode)
	}
}

func TestUpstreamJSONFieldsOpenAICompatible(t *testing.T) {
	body := []byte(`{"id":"chatcmpl-123","error":{"type":"invalid_request_error","message":"invalid model"}}`)
	requestID, errorCode := upstreamJSONFields(body)
	if requestID != "chatcmpl-123" {
		t.Fatalf("requestID = %q", requestID)
	}
	if errorCode != "invalid_request_error" {
		t.Fatalf("errorCode = %q", errorCode)
	}
}

func TestFirstHeaderValue(t *testing.T) {
	header := http.Header{}
	header.Set("X-Cos-Request-Id", "cos-request-123")
	if got := firstHeaderValue(header, "X-TC-RequestId", "X-Cos-Request-Id"); got != "cos-request-123" {
		t.Fatalf("header request id = %q", got)
	}
}

func TestSafeLogValueRemovesLineBreaks(t *testing.T) {
	if got := safeLogValue("request-id\nforged-log"); got != "request-id forged-log" {
		t.Fatalf("safeLogValue = %q", got)
	}
}

func TestLogUpstreamResultCorrelatesVendorRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set("request_id", "local-request-001")
	header := http.Header{}
	body := []byte(`{"Response":{"Error":{"Code":"InvalidParameter"},"RequestId":"vendor-request-001"}}`)

	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	logUpstreamResult(context, "tencent-cloud", "vod", "ApplyUpload", http.StatusBadRequest, time.Now(), header, body)
	line := output.String()
	for _, expected := range []string{
		`request_id="local-request-001"`, `upstream_request_id="vendor-request-001"`,
		`service="vod"`, `action="ApplyUpload"`, `error_code="InvalidParameter"`,
	} {
		if !strings.Contains(line, expected) {
			t.Fatalf("log line %q does not contain %q", line, expected)
		}
	}
	if got := recorder.Header().Get("X-Upstream-Request-ID"); got != "vendor-request-001" {
		t.Fatalf("X-Upstream-Request-ID = %q", got)
	}
}
