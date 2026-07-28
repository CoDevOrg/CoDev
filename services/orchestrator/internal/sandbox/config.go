package sandbox

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type FirecrackerConfig struct {
	RuntimeDir       string
	KernelImage      string
	RootfsImage      string
	FirecrackerBin   string
	JailerBin        string
	JailerDir        string
	MaxSandboxes     int
	VCPUCount        int64
	MemoryMiB        int64
	WorkspaceDiskGiB int
	IdleTimeout      time.Duration
}

func FirecrackerConfigFromEnvironment() (FirecrackerConfig, error) {
	config := FirecrackerConfig{
		RuntimeDir:       environment("CODEV_RUNTIME_DIR", "/var/lib/codev"),
		KernelImage:      environment("CODEV_KERNEL_IMAGE", "/var/lib/codev/base/vmlinux"),
		RootfsImage:      environment("CODEV_ROOTFS_IMAGE", "/var/lib/codev/base/rootfs.ext4"),
		FirecrackerBin:   environment("CODEV_FIRECRACKER_BIN", "/usr/local/bin/firecracker"),
		JailerBin:        environment("CODEV_JAILER_BIN", "/usr/local/bin/jailer"),
		JailerDir:        environment("CODEV_JAILER_DIR", "/srv/jailer"),
		MaxSandboxes:     2,
		VCPUCount:        2,
		MemoryMiB:        2048,
		WorkspaceDiskGiB: 10,
		IdleTimeout:      30 * time.Minute,
	}
	var err error
	if config.MaxSandboxes, err = environmentInt("CODEV_MAX_SANDBOXES", config.MaxSandboxes); err != nil {
		return FirecrackerConfig{}, err
	}
	vcpu, err := environmentInt("CODEV_VM_VCPU", int(config.VCPUCount))
	if err != nil {
		return FirecrackerConfig{}, err
	}
	config.VCPUCount = int64(vcpu)
	memory, err := environmentInt("CODEV_VM_MEMORY_MIB", int(config.MemoryMiB))
	if err != nil {
		return FirecrackerConfig{}, err
	}
	config.MemoryMiB = int64(memory)
	if config.WorkspaceDiskGiB, err = environmentInt("CODEV_VM_DISK_GIB", config.WorkspaceDiskGiB); err != nil {
		return FirecrackerConfig{}, err
	}
	if value := os.Getenv("CODEV_IDLE_TIMEOUT"); value != "" {
		config.IdleTimeout, err = time.ParseDuration(value)
		if err != nil {
			return FirecrackerConfig{}, fmt.Errorf("parse CODEV_IDLE_TIMEOUT: %w", err)
		}
	}
	if config.MaxSandboxes < 1 || config.MaxSandboxes > 8 {
		return FirecrackerConfig{}, fmt.Errorf("CODEV_MAX_SANDBOXES must be between 1 and 8")
	}
	if config.VCPUCount < 1 || config.VCPUCount > 8 {
		return FirecrackerConfig{}, fmt.Errorf("CODEV_VM_VCPU must be between 1 and 8")
	}
	if config.MemoryMiB < 256 || config.MemoryMiB > 8192 {
		return FirecrackerConfig{}, fmt.Errorf("CODEV_VM_MEMORY_MIB must be between 256 and 8192")
	}
	if config.WorkspaceDiskGiB < 1 || config.WorkspaceDiskGiB > 20 {
		return FirecrackerConfig{}, fmt.Errorf("CODEV_VM_DISK_GIB must be between 1 and 20")
	}
	if config.IdleTimeout < time.Minute || config.IdleTimeout > 4*time.Hour {
		return FirecrackerConfig{}, fmt.Errorf("CODEV_IDLE_TIMEOUT must be between one minute and four hours")
	}
	return config, nil
}

func environment(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func environmentInt(name string, fallback int) (int, error) {
	value := os.Getenv(name)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", name, err)
	}
	return parsed, nil
}
