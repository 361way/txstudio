package app

import (
	"net/http"
	"testing"
	"time"
)

func TestShouldLogHTTPRequestSuppressesFastSuccessfulCanvasSave(t *testing.T) {
	if shouldLogHTTPRequest(http.MethodPut, "/api/projects/2/canvas", http.StatusOK, 150*time.Millisecond) {
		t.Fatal("fast successful canvas autosave should be suppressed")
	}
}

func TestShouldLogHTTPRequestKeepsCanvasSaveFailuresAndSlowRequests(t *testing.T) {
	cases := []struct {
		status   int
		duration time.Duration
	}{
		{status: http.StatusInternalServerError, duration: 150 * time.Millisecond},
		{status: http.StatusOK, duration: 2 * time.Second},
	}
	for _, testCase := range cases {
		if !shouldLogHTTPRequest(http.MethodPut, "/api/projects/2/canvas", testCase.status, testCase.duration) {
			t.Fatalf("canvas save should be logged: status=%d duration=%s", testCase.status, testCase.duration)
		}
	}
}

func TestShouldLogHTTPRequestKeepsOtherRequests(t *testing.T) {
	if !shouldLogHTTPRequest(http.MethodGet, "/api/projects/2/canvas", http.StatusOK, 10*time.Millisecond) {
		t.Fatal("non-autosave request should be logged")
	}
	if !shouldLogHTTPRequest(http.MethodPut, "/api/projects/invalid/canvas", http.StatusOK, 10*time.Millisecond) {
		t.Fatal("non-matching project path should be logged")
	}
}
