package sandbox

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestFakeBackendLifecycle(t *testing.T) {
	t.Parallel()

	backend := NewFakeBackend()
	expiresAt := time.Now().Add(time.Hour)
	instance, err := backend.Create(context.Background(), CreateRequest{
		WorkspaceID:   "workspace-1",
		RepositoryURL: "https://github.com/yousef20920/CoDev.git",
		BaseSHA:       "fc1ba2947ffd0000000000000000000000000000",
		ExpiresAt:     expiresAt,
	})
	if err != nil {
		t.Fatalf("create sandbox: %v", err)
	}

	got, err := backend.Get(context.Background(), instance.WorkspaceID)
	if err != nil {
		t.Fatalf("get sandbox: %v", err)
	}
	if got.WorkspaceID != "workspace-1" {
		t.Fatalf("workspace ID = %q, want workspace-1", got.WorkspaceID)
	}

	if err := backend.Destroy(context.Background(), instance.WorkspaceID); err != nil {
		t.Fatalf("destroy sandbox: %v", err)
	}
	if _, err := backend.Get(context.Background(), instance.WorkspaceID); !errors.Is(err, ErrSandboxNotFound) {
		t.Fatalf("get destroyed sandbox error = %v, want ErrSandboxNotFound", err)
	}
}
