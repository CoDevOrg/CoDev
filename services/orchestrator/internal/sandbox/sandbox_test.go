package sandbox

import (
	"context"
	"errors"
	"testing"
)

func TestFakeBackendLifecycle(t *testing.T) {
	t.Parallel()

	backend := NewFakeBackend()
	instance, err := backend.Create(context.Background(), "workspace-1")
	if err != nil {
		t.Fatalf("create sandbox: %v", err)
	}

	got, err := backend.Get(context.Background(), instance.ID)
	if err != nil {
		t.Fatalf("get sandbox: %v", err)
	}
	if got.WorkspaceID != "workspace-1" {
		t.Fatalf("workspace ID = %q, want workspace-1", got.WorkspaceID)
	}

	if err := backend.Destroy(context.Background(), instance.ID); err != nil {
		t.Fatalf("destroy sandbox: %v", err)
	}
	if _, err := backend.Get(context.Background(), instance.ID); !errors.Is(err, ErrSandboxNotFound) {
		t.Fatalf("get destroyed sandbox error = %v, want ErrSandboxNotFound", err)
	}
}
