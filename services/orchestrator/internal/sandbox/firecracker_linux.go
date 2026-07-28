//go:build linux

package sandbox

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	firecracker "github.com/firecracker-microvm/firecracker-go-sdk"
	"github.com/firecracker-microvm/firecracker-go-sdk/client/models"
	"github.com/sirupsen/logrus"
	"golang.org/x/sys/unix"

	"github.com/yousef20920/CoDev/services/orchestrator/internal/guestapi"
	"github.com/yousef20920/CoDev/services/orchestrator/internal/guestclient"
)

const guestPort = 52

type runningMachine struct {
	instance Instance
	machine  *firecracker.Machine
	cancel   context.CancelFunc
	guest    *guestclient.Client
	dir      string
	jailDir  string
}

type FirecrackerBackend struct {
	mu          sync.RWMutex
	provisionMu sync.Mutex
	config      FirecrackerConfig
	machines    map[string]*runningMachine
	now         func() time.Time
}

func NewFirecrackerBackend(config FirecrackerConfig) (Backend, error) {
	backend := &FirecrackerBackend{
		config:   config,
		machines: make(map[string]*runningMachine),
		now:      time.Now,
	}
	if err := backend.Health(context.Background()); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(config.RuntimeDir, "workspaces"), 0o700); err != nil {
		return nil, fmt.Errorf("create runtime directory: %w", err)
	}
	if err := os.MkdirAll(config.JailerDir, 0o755); err != nil {
		return nil, fmt.Errorf("create jailer directory: %w", err)
	}
	if err := backend.removeStaleRuntime(); err != nil {
		return nil, err
	}
	return backend, nil
}

func (backend *FirecrackerBackend) Health(_ context.Context) error {
	for name, path := range map[string]string{
		"KVM device":         "/dev/kvm",
		"kernel image":       backend.config.KernelImage,
		"rootfs image":       backend.config.RootfsImage,
		"Firecracker binary": backend.config.FirecrackerBin,
		"jailer binary":      backend.config.JailerBin,
	} {
		if _, err := os.Stat(path); err != nil {
			return fmt.Errorf("%s unavailable: %w", name, err)
		}
	}
	if err := unix.Access("/dev/kvm", unix.R_OK|unix.W_OK); err != nil {
		return fmt.Errorf("KVM device is not readable and writable: %w", err)
	}
	return nil
}

func (backend *FirecrackerBackend) Create(
	ctx context.Context,
	request CreateRequest,
) (Instance, error) {
	backend.provisionMu.Lock()
	defer backend.provisionMu.Unlock()

	backend.mu.Lock()
	if machine, ok := backend.machines[request.WorkspaceID]; ok {
		instance := machine.instance
		backend.mu.Unlock()
		return instance, nil
	}
	if len(backend.machines) >= backend.config.MaxSandboxes {
		backend.mu.Unlock()
		return Instance{}, ErrCapacityExceeded
	}
	backend.mu.Unlock()

	machine, err := backend.prepareAndStart(ctx, request)
	if err != nil {
		return Instance{}, err
	}

	backend.mu.Lock()
	if existing, ok := backend.machines[request.WorkspaceID]; ok {
		backend.mu.Unlock()
		_ = backend.stopMachine(machine)
		return existing.instance, nil
	}
	backend.machines[request.WorkspaceID] = machine
	backend.mu.Unlock()
	return machine.instance, nil
}

func (backend *FirecrackerBackend) Get(_ context.Context, workspaceID string) (Instance, error) {
	backend.mu.RLock()
	defer backend.mu.RUnlock()
	machine, ok := backend.machines[workspaceID]
	if !ok {
		return Instance{}, ErrSandboxNotFound
	}
	return machine.instance, nil
}

func (backend *FirecrackerBackend) Touch(_ context.Context, workspaceID string) (Instance, error) {
	backend.mu.Lock()
	defer backend.mu.Unlock()
	machine, ok := backend.machines[workspaceID]
	if !ok {
		return Instance{}, ErrSandboxNotFound
	}
	machine.instance.LastActivityAt = backend.now().UTC()
	return machine.instance, nil
}

func (backend *FirecrackerBackend) Destroy(_ context.Context, workspaceID string) error {
	backend.mu.Lock()
	machine, ok := backend.machines[workspaceID]
	if !ok {
		backend.mu.Unlock()
		return ErrSandboxNotFound
	}
	delete(backend.machines, workspaceID)
	backend.mu.Unlock()
	return backend.stopMachine(machine)
}

func (backend *FirecrackerBackend) ReapIdle(
	ctx context.Context,
	cutoff time.Time,
) ([]string, error) {
	backend.mu.RLock()
	now := backend.now().UTC()
	var workspaceIDs []string
	for workspaceID, machine := range backend.machines {
		if machine.instance.LastActivityAt.Before(cutoff) ||
			!machine.instance.ExpiresAt.After(now) {
			workspaceIDs = append(workspaceIDs, workspaceID)
		}
	}
	backend.mu.RUnlock()

	var destroyed []string
	var failures []error
	for _, workspaceID := range workspaceIDs {
		if err := backend.Destroy(ctx, workspaceID); err != nil {
			failures = append(failures, fmt.Errorf("destroy %s: %w", workspaceID, err))
			continue
		}
		destroyed = append(destroyed, workspaceID)
	}
	return destroyed, errors.Join(failures...)
}

func (backend *FirecrackerBackend) ReadFile(
	ctx context.Context,
	workspaceID string,
	path string,
) (File, error) {
	machine, err := backend.running(workspaceID)
	if err != nil {
		return File{}, err
	}
	result, err := machine.guest.ReadFile(ctx, path)
	if err != nil {
		return File{}, fmt.Errorf("%w: %v", ErrGuestUnavailable, err)
	}
	backend.markActivity(workspaceID)
	return File{
		Path:     result.Path,
		Contents: result.Contents,
		Revision: result.Revision,
	}, nil
}

func (backend *FirecrackerBackend) WriteFile(
	ctx context.Context,
	workspaceID string,
	path string,
	contents string,
	expectedRevision string,
) (string, error) {
	machine, err := backend.running(workspaceID)
	if err != nil {
		return "", err
	}
	result, err := machine.guest.WriteFile(ctx, guestapi.WriteFileRequest{
		Path:             path,
		Contents:         contents,
		ExpectedRevision: expectedRevision,
	})
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrGuestUnavailable, err)
	}
	backend.markActivity(workspaceID)
	return result.Revision, nil
}

func (backend *FirecrackerBackend) Exec(
	ctx context.Context,
	workspaceID string,
	request ExecRequest,
) (ExecResult, error) {
	machine, err := backend.running(workspaceID)
	if err != nil {
		return ExecResult{}, err
	}
	result, err := machine.guest.Exec(ctx, guestapi.ExecRequest{
		Command:        request.Command,
		WorkingDir:     request.WorkingDir,
		TimeoutSeconds: request.TimeoutSeconds,
		Rows:           request.Rows,
		Columns:        request.Columns,
	})
	if err != nil {
		return ExecResult{}, fmt.Errorf("%w: %v", ErrGuestUnavailable, err)
	}
	backend.markActivity(workspaceID)
	return ExecResult{Output: result.Output, ExitCode: result.ExitCode}, nil
}

func (backend *FirecrackerBackend) GitStatus(
	ctx context.Context,
	workspaceID string,
) (string, error) {
	machine, err := backend.running(workspaceID)
	if err != nil {
		return "", err
	}
	result, err := machine.guest.GitStatus(ctx)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrGuestUnavailable, err)
	}
	backend.markActivity(workspaceID)
	return result.Output, nil
}

func (backend *FirecrackerBackend) GitDiff(
	ctx context.Context,
	workspaceID string,
) (string, error) {
	machine, err := backend.running(workspaceID)
	if err != nil {
		return "", err
	}
	result, err := machine.guest.GitDiff(ctx)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrGuestUnavailable, err)
	}
	backend.markActivity(workspaceID)
	return result.Output, nil
}

func (backend *FirecrackerBackend) prepareAndStart(
	requestContext context.Context,
	request CreateRequest,
) (*runningMachine, error) {
	id := strings.ReplaceAll(request.WorkspaceID, "-", "")
	workspaceDir := filepath.Join(backend.config.RuntimeDir, "workspaces", request.WorkspaceID)
	if err := os.RemoveAll(workspaceDir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(workspaceDir, 0o700); err != nil {
		return nil, err
	}
	cleanup := func() {
		_ = os.RemoveAll(workspaceDir)
		_ = os.RemoveAll(filepath.Join(
			backend.config.JailerDir,
			filepath.Base(backend.config.FirecrackerBin),
			id,
		))
	}

	repositoryDir := filepath.Join(workspaceDir, "repository")
	if err := cloneRepository(requestContext, request.RepositoryURL, request.BaseSHA, repositoryDir); err != nil {
		cleanup()
		return nil, err
	}
	workspaceDisk := filepath.Join(workspaceDir, "workspace.ext4")
	if err := createWorkspaceDisk(
		requestContext,
		repositoryDir,
		workspaceDisk,
		backend.config.WorkspaceDiskGiB,
	); err != nil {
		cleanup()
		return nil, err
	}
	if err := os.RemoveAll(repositoryDir); err != nil {
		cleanup()
		return nil, err
	}
	rootfs := filepath.Join(workspaceDir, "rootfs.ext4")
	if err := runCommand(requestContext, "cp", "--reflink=auto", "--sparse=always", backend.config.RootfsImage, rootfs); err != nil {
		cleanup()
		return nil, err
	}

	uid := 20000 + len(backend.machines)
	gid := uid
	numa := 0
	vmContext, cancel := context.WithCancel(context.Background())
	drives := firecracker.NewDrivesBuilder(rootfs).
		AddDrive(workspaceDisk, false).
		Build()
	config := firecracker.Config{
		SocketPath:      "api.socket",
		KernelImagePath: backend.config.KernelImage,
		KernelArgs:      "keep_bootcon console=ttyS0 reboot=k panic=1 pci=off quiet loglevel=1 8250.nr_uarts=0",
		Drives:          drives,
		VsockDevices: []firecracker.VsockDevice{{
			ID:   "codev-guest",
			Path: "guest.vsock",
			CID:  3,
		}},
		MachineCfg: models.MachineConfiguration{
			VcpuCount:  firecracker.Int64(backend.config.VCPUCount),
			Smt:        firecracker.Bool(false),
			MemSizeMib: firecracker.Int64(backend.config.MemoryMiB),
		},
		Seccomp: firecracker.SeccompConfig{Enabled: true},
		JailerCfg: &firecracker.JailerConfig{
			UID:            &uid,
			GID:            &gid,
			ID:             id,
			NumaNode:       &numa,
			ChrootBaseDir:  backend.config.JailerDir,
			ChrootStrategy: firecracker.NewNaiveChrootStrategy(backend.config.KernelImage),
			ExecFile:       backend.config.FirecrackerBin,
			JailerBinary:   backend.config.JailerBin,
			CgroupVersion:  "2",
			Stdout:         io.Discard,
			Stderr:         io.Discard,
		},
	}
	logger := logrus.New()
	logger.SetOutput(io.Discard)
	machine, err := firecracker.NewMachine(
		vmContext,
		config,
		firecracker.WithLogger(logrus.NewEntry(logger)),
	)
	if err != nil {
		cancel()
		cleanup()
		return nil, fmt.Errorf("configure Firecracker: %w", err)
	}
	if err := machine.Start(vmContext); err != nil {
		cancel()
		cleanup()
		return nil, fmt.Errorf("start Firecracker: %w", err)
	}

	jailDir := filepath.Join(
		backend.config.JailerDir,
		filepath.Base(backend.config.FirecrackerBin),
		id,
	)
	vsockPath := filepath.Join(jailDir, "root", "guest.vsock")
	guest := guestclient.New(vsockPath, guestPort)
	readyContext, readyCancel := context.WithTimeout(requestContext, 45*time.Second)
	defer readyCancel()
	if err := waitForGuest(readyContext, guest); err != nil {
		_ = machine.StopVMM()
		cancel()
		cleanup()
		return nil, err
	}

	now := backend.now().UTC()
	return &runningMachine{
		instance: Instance{
			ID:             "fc-" + id,
			WorkspaceID:    request.WorkspaceID,
			Status:         "ready",
			CreatedAt:      now,
			LastActivityAt: now,
			ExpiresAt:      request.ExpiresAt.UTC(),
		},
		machine: machine,
		cancel:  cancel,
		guest:   guest,
		dir:     workspaceDir,
		jailDir: jailDir,
	}, nil
}

func (backend *FirecrackerBackend) running(workspaceID string) (*runningMachine, error) {
	backend.mu.RLock()
	defer backend.mu.RUnlock()
	machine, ok := backend.machines[workspaceID]
	if !ok {
		return nil, ErrSandboxNotFound
	}
	return machine, nil
}

func (backend *FirecrackerBackend) markActivity(workspaceID string) {
	backend.mu.Lock()
	defer backend.mu.Unlock()
	if machine, ok := backend.machines[workspaceID]; ok {
		machine.instance.LastActivityAt = backend.now().UTC()
	}
}

func (backend *FirecrackerBackend) stopMachine(machine *runningMachine) error {
	var failures []error
	if err := machine.machine.StopVMM(); err != nil {
		failures = append(failures, err)
	}
	machine.cancel()
	if err := os.RemoveAll(machine.jailDir); err != nil {
		failures = append(failures, err)
	}
	if err := os.RemoveAll(machine.dir); err != nil {
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}

func (backend *FirecrackerBackend) removeStaleRuntime() error {
	if err := os.RemoveAll(filepath.Join(backend.config.RuntimeDir, "workspaces")); err != nil {
		return fmt.Errorf("remove stale workspace disks: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(backend.config.RuntimeDir, "workspaces"), 0o700); err != nil {
		return err
	}
	firecrackerJails := filepath.Join(
		backend.config.JailerDir,
		filepath.Base(backend.config.FirecrackerBin),
	)
	if err := os.RemoveAll(firecrackerJails); err != nil {
		return fmt.Errorf("remove stale Firecracker jails: %w", err)
	}
	return nil
}

func cloneRepository(
	ctx context.Context,
	repositoryURL string,
	baseSHA string,
	destination string,
) error {
	if err := runCommand(ctx, "git", "init", "--quiet", destination); err != nil {
		return err
	}
	if err := runCommand(ctx, "git", "-C", destination, "remote", "add", "origin", repositoryURL); err != nil {
		return err
	}
	if err := runCommand(ctx, "git", "-C", destination, "fetch", "--quiet", "--depth=1", "origin", baseSHA); err != nil {
		return err
	}
	if err := runCommand(ctx, "git", "-C", destination, "checkout", "--quiet", "--detach", "FETCH_HEAD"); err != nil {
		return err
	}
	return nil
}

func createWorkspaceDisk(
	ctx context.Context,
	repositoryDir string,
	diskPath string,
	sizeGiB int,
) error {
	if err := runCommand(ctx, "truncate", "-s", fmt.Sprintf("%dG", sizeGiB), diskPath); err != nil {
		return err
	}
	return runCommand(ctx, "mkfs.ext4", "-q", "-F", "-d", repositoryDir, "-L", "CODEV_WORKSPACE", diskPath)
}

func runCommand(ctx context.Context, name string, arguments ...string) error {
	command := exec.CommandContext(ctx, name, arguments...)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s failed: %w: %s", name, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func waitForGuest(ctx context.Context, client *guestclient.Client) error {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := client.Health(ctx); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("guest daemon did not become ready: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}
