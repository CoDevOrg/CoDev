package sandbox

import (
	"context"
	"errors"
	"sync"
)

var ErrSandboxNotFound = errors.New("sandbox not found")

type Instance struct {
	ID          string
	WorkspaceID string
	Status      string
}

type Backend interface {
	Create(context.Context, string) (Instance, error)
	Get(context.Context, string) (Instance, error)
	Destroy(context.Context, string) error
}

type FakeBackend struct {
	mu        sync.RWMutex
	instances map[string]Instance
}

func NewFakeBackend() *FakeBackend {
	return &FakeBackend{instances: make(map[string]Instance)}
}

func (backend *FakeBackend) Create(_ context.Context, workspaceID string) (Instance, error) {
	backend.mu.Lock()
	defer backend.mu.Unlock()

	instance := Instance{
		ID:          "sandbox-" + workspaceID,
		WorkspaceID: workspaceID,
		Status:      "ready",
	}
	backend.instances[instance.ID] = instance
	return instance, nil
}

func (backend *FakeBackend) Get(_ context.Context, id string) (Instance, error) {
	backend.mu.RLock()
	defer backend.mu.RUnlock()

	instance, ok := backend.instances[id]
	if !ok {
		return Instance{}, ErrSandboxNotFound
	}
	return instance, nil
}

func (backend *FakeBackend) Destroy(_ context.Context, id string) error {
	backend.mu.Lock()
	defer backend.mu.Unlock()

	if _, ok := backend.instances[id]; !ok {
		return ErrSandboxNotFound
	}
	delete(backend.instances, id)
	return nil
}
