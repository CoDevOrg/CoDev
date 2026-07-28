package sandbox

import (
	"context"
	"errors"
	"sync"
	"time"
)

var ErrSandboxNotFound = errors.New("sandbox not found")
var ErrCapacityExceeded = errors.New("sandbox capacity exceeded")
var ErrGuestUnavailable = errors.New("sandbox guest unavailable")

type CreateRequest struct {
	WorkspaceID   string    `json:"workspaceId"`
	RepositoryURL string    `json:"repositoryUrl"`
	BaseSHA       string    `json:"baseSha"`
	ExpiresAt     time.Time `json:"expiresAt"`
}

type Instance struct {
	ID             string    `json:"id"`
	WorkspaceID    string    `json:"workspaceId"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
	LastActivityAt time.Time `json:"lastActivityAt"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

type File struct {
	Path     string `json:"path"`
	Contents string `json:"contents"`
	Revision string `json:"revision"`
}

type ExecRequest struct {
	Command        []string `json:"command"`
	WorkingDir     string   `json:"workingDir"`
	TimeoutSeconds int      `json:"timeoutSeconds"`
	Rows           uint16   `json:"rows"`
	Columns        uint16   `json:"columns"`
}

type ExecResult struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
}

type Backend interface {
	Health(context.Context) error
	Create(context.Context, CreateRequest) (Instance, error)
	Get(context.Context, string) (Instance, error)
	Touch(context.Context, string) (Instance, error)
	Destroy(context.Context, string) error
	ReapIdle(context.Context, time.Time) ([]string, error)
	ReadFile(context.Context, string, string) (File, error)
	WriteFile(context.Context, string, string, string, string) (string, error)
	Exec(context.Context, string, ExecRequest) (ExecResult, error)
	GitStatus(context.Context, string) (string, error)
	GitDiff(context.Context, string) (string, error)
}

type FakeBackend struct {
	mu        sync.RWMutex
	instances map[string]Instance
	now       func() time.Time
	max       int
}

func NewFakeBackend() *FakeBackend {
	return &FakeBackend{
		instances: make(map[string]Instance),
		now:       time.Now,
		max:       2,
	}
}

func (backend *FakeBackend) Health(_ context.Context) error {
	return nil
}

func (backend *FakeBackend) Create(_ context.Context, request CreateRequest) (Instance, error) {
	backend.mu.Lock()
	defer backend.mu.Unlock()

	if instance, ok := backend.instances[request.WorkspaceID]; ok {
		return instance, nil
	}
	if len(backend.instances) >= backend.max {
		return Instance{}, ErrCapacityExceeded
	}

	now := backend.now().UTC()
	instance := Instance{
		ID:             "sandbox-" + request.WorkspaceID,
		WorkspaceID:    request.WorkspaceID,
		Status:         "ready",
		CreatedAt:      now,
		LastActivityAt: now,
		ExpiresAt:      request.ExpiresAt.UTC(),
	}
	backend.instances[instance.WorkspaceID] = instance
	return instance, nil
}

func (backend *FakeBackend) Get(_ context.Context, workspaceID string) (Instance, error) {
	backend.mu.RLock()
	defer backend.mu.RUnlock()

	instance, ok := backend.instances[workspaceID]
	if !ok {
		return Instance{}, ErrSandboxNotFound
	}
	return instance, nil
}

func (backend *FakeBackend) Touch(_ context.Context, workspaceID string) (Instance, error) {
	backend.mu.Lock()
	defer backend.mu.Unlock()

	instance, ok := backend.instances[workspaceID]
	if !ok {
		return Instance{}, ErrSandboxNotFound
	}
	instance.LastActivityAt = backend.now().UTC()
	backend.instances[workspaceID] = instance
	return instance, nil
}

func (backend *FakeBackend) Destroy(_ context.Context, workspaceID string) error {
	backend.mu.Lock()
	defer backend.mu.Unlock()

	if _, ok := backend.instances[workspaceID]; !ok {
		return ErrSandboxNotFound
	}
	delete(backend.instances, workspaceID)
	return nil
}

func (backend *FakeBackend) ReapIdle(_ context.Context, cutoff time.Time) ([]string, error) {
	backend.mu.Lock()
	defer backend.mu.Unlock()

	now := backend.now().UTC()
	var destroyed []string
	for workspaceID, instance := range backend.instances {
		if instance.LastActivityAt.Before(cutoff) || !instance.ExpiresAt.After(now) {
			delete(backend.instances, workspaceID)
			destroyed = append(destroyed, workspaceID)
		}
	}
	return destroyed, nil
}

func (backend *FakeBackend) ReadFile(
	_ context.Context,
	workspaceID string,
	path string,
) (File, error) {
	if _, err := backend.Get(context.Background(), workspaceID); err != nil {
		return File{}, err
	}
	return File{Path: path, Contents: "", Revision: "missing"}, nil
}

func (backend *FakeBackend) WriteFile(
	_ context.Context,
	workspaceID string,
	_ string,
	_ string,
	expectedRevision string,
) (string, error) {
	if _, err := backend.Get(context.Background(), workspaceID); err != nil {
		return "", err
	}
	return expectedRevision + ":next", nil
}

func (backend *FakeBackend) Exec(
	_ context.Context,
	workspaceID string,
	_ ExecRequest,
) (ExecResult, error) {
	if _, err := backend.Get(context.Background(), workspaceID); err != nil {
		return ExecResult{}, err
	}
	return ExecResult{ExitCode: 0}, nil
}

func (backend *FakeBackend) GitStatus(
	_ context.Context,
	workspaceID string,
) (string, error) {
	if _, err := backend.Get(context.Background(), workspaceID); err != nil {
		return "", err
	}
	return "## main", nil
}

func (backend *FakeBackend) GitDiff(
	_ context.Context,
	workspaceID string,
) (string, error) {
	if _, err := backend.Get(context.Background(), workspaceID); err != nil {
		return "", err
	}
	return "", nil
}
