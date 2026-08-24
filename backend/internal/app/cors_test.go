package app

import (
	"testing"

	"github.com/gin-gonic/gin"
)

func TestIsAllowedLocalUIOrigin(t *testing.T) {
	const port = 18080

	tests := []struct {
		origin string
		want   bool
	}{
		{"http://127.0.0.1:18080", true},
		{"http://localhost:18080", true},
		{"http://127.0.0.1:5173", false},
		{"http://localhost:5173", false},
		{"http://127.0.0.1:8080", false},
		{"http://localhost:9999", false},
		{"https://localhost:18080", false},
		{"http://example.com:18080", false},
		{"null", false},
		{"file://", false},
	}

	for _, test := range tests {
		t.Run(test.origin, func(t *testing.T) {
			if got := isAllowedLocalUIOrigin(test.origin, port); got != test.want {
				t.Fatalf("isAllowedLocalUIOrigin(%q) = %v, want %v", test.origin, got, test.want)
			}
		})
	}
}

func TestLocalCORSConfigReleaseAndDebugModes(t *testing.T) {
	const port = 18080
	for _, test := range []struct {
		name   string
		mode   string
		origin string
		want   bool
	}{
		{"release same port", gin.ReleaseMode, "http://localhost:18080", true},
		{"release vite denied", gin.ReleaseMode, "http://localhost:5173", false},
		{"debug vite allowed", gin.DebugMode, "http://localhost:5173", true},
		{"debug foreign denied", gin.DebugMode, "http://example.com:5173", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := localCORSConfig(port, test.mode).AllowOriginFunc(test.origin); got != test.want {
				t.Fatalf("CORS origin %q in %s = %v, want %v", test.origin, test.mode, got, test.want)
			}
		})
	}
}
