package handler

import "testing"

func TestNormalizeAigcStorageModeDefaultsToPermanent(t *testing.T) {
	payload := map[string]interface{}{}
	if err := normalizeAigcStorageMode("CreateAigcImageTask", payload); err != nil {
		t.Fatal(err)
	}
	config, ok := payload["OutputConfig"].(map[string]interface{})
	if !ok || config["StorageMode"] != "Permanent" {
		t.Fatalf("unexpected default output config: %#v", payload)
	}
}

func TestNormalizeAigcStorageModePreservesTemporary(t *testing.T) {
	payload := map[string]interface{}{"OutputConfig": map[string]interface{}{"StorageMode": "Temporary"}}
	if err := normalizeAigcStorageMode("CreateAigcVideoTask", payload); err != nil {
		t.Fatal(err)
	}
	config := payload["OutputConfig"].(map[string]interface{})
	if config["StorageMode"] != "Temporary" {
		t.Fatalf("temporary mode was changed: %#v", config)
	}
}

func TestNormalizeAigcStorageModeRejectsInvalidValue(t *testing.T) {
	payload := map[string]interface{}{"OutputConfig": map[string]interface{}{"StorageMode": "Archive"}}
	if err := normalizeAigcStorageMode("CreateAigcImageTask", payload); err == nil {
		t.Fatal("expected invalid storage mode to be rejected")
	}
}
