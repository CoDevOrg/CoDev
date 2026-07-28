package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/yousef20920/CoDev/services/orchestrator/internal/sandbox"
)

const testWorkspaceID = "e010bd2c-a3c1-438f-acef-166287a3b1cb"

func TestSandboxLifecycle(t *testing.T) {
	t.Parallel()

	backend := sandbox.NewFakeBackend()
	server := New(backend)
	server.now = func() time.Time {
		return time.Date(2026, 7, 28, 20, 0, 0, 0, time.UTC)
	}
	handler := server.Handler()

	body, err := json.Marshal(sandbox.CreateRequest{
		WorkspaceID:   testWorkspaceID,
		RepositoryURL: "https://github.com/yousef20920/CoDev.git",
		BaseSHA:       "fc1ba2947ffd0000000000000000000000000000",
		ExpiresAt:     server.now().Add(4 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}

	create := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewReader(body))
	createResult := httptest.NewRecorder()
	handler.ServeHTTP(createResult, create)
	if createResult.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createResult.Code, createResult.Body.String())
	}

	get := httptest.NewRequest(http.MethodGet, "/v1/sandboxes/"+testWorkspaceID, nil)
	getResult := httptest.NewRecorder()
	handler.ServeHTTP(getResult, get)
	if getResult.Code != http.StatusOK {
		t.Fatalf("get status = %d, body = %s", getResult.Code, getResult.Body.String())
	}

	destroy := httptest.NewRequest(http.MethodDelete, "/v1/sandboxes/"+testWorkspaceID, nil)
	destroyResult := httptest.NewRecorder()
	handler.ServeHTTP(destroyResult, destroy)
	if destroyResult.Code != http.StatusNoContent {
		t.Fatalf("destroy status = %d, body = %s", destroyResult.Code, destroyResult.Body.String())
	}
}

func TestCreateRejectsUntrustedRepository(t *testing.T) {
	t.Parallel()

	server := New(sandbox.NewFakeBackend())
	now := time.Now().UTC()
	server.now = func() time.Time { return now }

	body, err := json.Marshal(sandbox.CreateRequest{
		WorkspaceID:   testWorkspaceID,
		RepositoryURL: "https://example.com/owner/repository.git",
		BaseSHA:       "fc1ba2947ffd0000000000000000000000000000",
		ExpiresAt:     now.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/sandboxes", bytes.NewReader(body))
	result := httptest.NewRecorder()
	server.Handler().ServeHTTP(result, request)
	if result.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", result.Code, http.StatusBadRequest)
	}
}
