package guestapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestFileReadWriteUsesRevisions(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	path := filepath.Join(root, "README.md")
	if err := os.WriteFile(path, []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := New(root)
	if err != nil {
		t.Fatal(err)
	}

	readBody, _ := json.Marshal(FileRequest{Path: "README.md"})
	readRequest := httptest.NewRequest(http.MethodPost, "/v1/files/read", bytes.NewReader(readBody))
	readResult := httptest.NewRecorder()
	server.Handler().ServeHTTP(readResult, readRequest)
	if readResult.Code != http.StatusOK {
		t.Fatalf("read status = %d, body = %s", readResult.Code, readResult.Body.String())
	}
	var current FileResponse
	if err := json.Unmarshal(readResult.Body.Bytes(), &current); err != nil {
		t.Fatal(err)
	}

	writeBody, _ := json.Marshal(WriteFileRequest{
		Path:             "README.md",
		Contents:         "after",
		ExpectedRevision: current.Revision,
	})
	writeRequest := httptest.NewRequest(http.MethodPost, "/v1/files/write", bytes.NewReader(writeBody))
	writeResult := httptest.NewRecorder()
	server.Handler().ServeHTTP(writeResult, writeRequest)
	if writeResult.Code != http.StatusOK {
		t.Fatalf("write status = %d, body = %s", writeResult.Code, writeResult.Body.String())
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "after" {
		t.Fatalf("contents = %q, want after", contents)
	}
}

func TestFileReadRejectsSymlinkEscape(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(outside, []byte("nope"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	server, err := New(root)
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(FileRequest{Path: "escape"})
	request := httptest.NewRequest(http.MethodPost, "/v1/files/read", bytes.NewReader(body))
	result := httptest.NewRecorder()
	server.Handler().ServeHTTP(result, request)
	if result.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", result.Code, http.StatusBadRequest)
	}
}
