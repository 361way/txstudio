package handler

import (
	"encoding/json"
	"testing"
)

func TestParsePositiveUint64(t *testing.T) {
	tests := []struct {
		name    string
		input   interface{}
		want    uint64
		wantErr bool
	}{
		{name: "string", input: "1500046368", want: 1500046368},
		{name: "json number", input: json.Number("1500046368"), want: 1500046368},
		{name: "float64", input: float64(1500046368), want: 1500046368},
		{name: "uint64", input: uint64(1500046368), want: 1500046368},
		{name: "empty", input: "", wantErr: true},
		{name: "zero", input: 0, wantErr: true},
		{name: "negative", input: -1, wantErr: true},
		{name: "decimal", input: 1.5, wantErr: true},
		{name: "invalid string", input: "not-a-number", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parsePositiveUint64(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatalf("parsePositiveUint64(%v) expected error", test.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("parsePositiveUint64(%v) returned error: %v", test.input, err)
			}
			if got != test.want {
				t.Fatalf("parsePositiveUint64(%v) = %d, want %d", test.input, got, test.want)
			}
		})
	}
}
