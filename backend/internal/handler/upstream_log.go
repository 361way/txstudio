package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const maxUpstreamLogValue = 256

func safeLogValue(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if len(value) > maxUpstreamLogValue {
		return value[:maxUpstreamLogValue]
	}
	return value
}

func localRequestID(c *gin.Context) string {
	value, _ := c.Get("request_id")
	return safeLogValue(strings.TrimSpace(toLogString(value)))
}

func toLogString(value any) string {
	text, _ := value.(string)
	return text
}

func firstHeaderValue(header http.Header, keys ...string) string {
	for _, key := range keys {
		if value := safeLogValue(header.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func findJSONText(value any, keys ...string) string {
	wanted := make(map[string]bool, len(keys))
	for _, key := range keys {
		wanted[strings.ToLower(key)] = true
	}
	var walk func(any) string
	walk = func(current any) string {
		switch typed := current.(type) {
		case map[string]any:
			for key, item := range typed {
				if wanted[strings.ToLower(key)] {
					if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
						return safeLogValue(text)
					}
				}
			}
			for _, item := range typed {
				if found := walk(item); found != "" {
					return found
				}
			}
		case []any:
			for _, item := range typed {
				if found := walk(item); found != "" {
					return found
				}
			}
		}
		return ""
	}
	return walk(value)
}

func findErrorCode(value any) string {
	root, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	for key, item := range root {
		if !strings.EqualFold(key, "error") {
			continue
		}
		if errorMap, ok := item.(map[string]any); ok {
			return findJSONText(errorMap, "Code", "code", "ErrorCode", "error_code", "type")
		}
	}
	for _, item := range root {
		if found := findErrorCode(item); found != "" {
			return found
		}
	}
	return ""
}

func upstreamJSONFields(body []byte) (requestID, errorCode string) {
	if len(body) == 0 || len(body) > 4<<20 {
		return "", ""
	}
	var payload any
	if json.Unmarshal(body, &payload) != nil {
		return "", ""
	}
	return findJSONText(payload, "RequestId", "RequestID", "request_id", "id"), findErrorCode(payload)
}

func logUpstreamResult(c *gin.Context, provider, service, action string, status int, startedAt time.Time, responseHeader http.Header, responseBody []byte) {
	bodyRequestID, errorCode := upstreamJSONFields(responseBody)
	upstreamRequestID := firstHeaderValue(responseHeader,
		"X-TC-RequestId", "X-TC-Request-ID", "X-Request-ID", "Request-ID", "X-Cos-Request-Id")
	if upstreamRequestID == "" {
		upstreamRequestID = bodyRequestID
	}
	traceID := firstHeaderValue(responseHeader, "X-Cos-Trace-Id", "X-B3-TraceId", "Traceparent")
	if upstreamRequestID != "" {
		c.Header("X-Upstream-Request-ID", upstreamRequestID)
	}
	log.Printf("[upstream] request_id=%q provider=%q service=%q action=%q upstream_request_id=%q trace_id=%q status=%d error_code=%q duration_ms=%d",
		localRequestID(c), safeLogValue(provider), safeLogValue(service), safeLogValue(action), upstreamRequestID,
		traceID, status, errorCode, time.Since(startedAt).Milliseconds())
}

func logUpstreamTransportError(c *gin.Context, provider, service, action string, startedAt time.Time, err error) {
	errorType := "transport_error"
	if err != nil && (strings.Contains(strings.ToLower(err.Error()), "timeout") || strings.Contains(strings.ToLower(err.Error()), "deadline")) {
		errorType = "timeout"
	}
	log.Printf("[upstream] request_id=%q provider=%q service=%q action=%q upstream_request_id=%q trace_id=%q status=0 error_code=%q duration_ms=%d",
		localRequestID(c), safeLogValue(provider), safeLogValue(service), safeLogValue(action), "", "", errorType, time.Since(startedAt).Milliseconds())
}
