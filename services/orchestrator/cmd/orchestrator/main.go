package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/yousef20920/CoDev/services/orchestrator/internal/httpapi"
	"github.com/yousef20920/CoDev/services/orchestrator/internal/sandbox"
)

func main() {
	backend, idleTimeout, err := configureBackend()
	if err != nil {
		slog.Error("configure sandbox backend", "error", err)
		os.Exit(1)
	}
	hostIdleTimeout, err := hostIdleTimeoutFromEnvironment()
	if err != nil {
		slog.Error("configure host idle timeout", "error", err)
		os.Exit(1)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.New(backend).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       70 * time.Second,
		WriteTimeout:      70 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go reapIdleSandboxes(ctx, backend, idleTimeout)
	go stopIdleHost(ctx, backend, hostIdleTimeout)

	go func() {
		slog.Info("orchestrator listening", "address", server.Addr)
		if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			slog.Error("orchestrator stopped unexpectedly", "error", err)
			stop()
		}
	}()

	<-ctx.Done()

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		slog.Error("orchestrator shutdown", "error", err)
	}
}

func hostIdleTimeoutFromEnvironment() (time.Duration, error) {
	value := os.Getenv("CODEV_HOST_IDLE_TIMEOUT")
	if value == "" || value == "0" {
		return 0, nil
	}
	timeout, err := time.ParseDuration(value)
	if err != nil {
		return 0, errors.New("CODEV_HOST_IDLE_TIMEOUT must be a duration")
	}
	if timeout < 5*time.Minute || timeout > 4*time.Hour {
		return 0, errors.New("CODEV_HOST_IDLE_TIMEOUT must be between five minutes and four hours")
	}
	return timeout, nil
}

func stopIdleHost(
	ctx context.Context,
	backend sandbox.Backend,
	idleTimeout time.Duration,
) {
	if idleTimeout <= 0 {
		return
	}
	controller := idleHostController{timeout: idleTimeout}
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if !controller.observe(now, backend.ActiveCount()) {
				continue
			}
			slog.Info("stopping idle Firecracker host", "idle_timeout", idleTimeout)
			powerOffContext, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			output, err := exec.CommandContext(powerOffContext, "systemctl", "poweroff").CombinedOutput()
			cancel()
			if err != nil {
				slog.Error(
					"stop idle Firecracker host",
					"error",
					err,
					"output",
					string(output),
				)
				controller.reset(now)
				continue
			}
			return
		}
	}
}

func configureBackend() (sandbox.Backend, time.Duration, error) {
	backendName := os.Getenv("SANDBOX_BACKEND")
	if backendName == "" || backendName == "fake" {
		return sandbox.NewFakeBackend(), 30 * time.Minute, nil
	}
	if backendName != "firecracker" {
		return nil, 0, errors.New("SANDBOX_BACKEND must be fake or firecracker")
	}
	config, err := sandbox.FirecrackerConfigFromEnvironment()
	if err != nil {
		return nil, 0, err
	}
	backend, err := sandbox.NewFirecrackerBackend(config)
	if err != nil {
		return nil, 0, err
	}
	return backend, config.IdleTimeout, nil
}

func reapIdleSandboxes(
	ctx context.Context,
	backend sandbox.Backend,
	idleTimeout time.Duration,
) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			destroyed, err := backend.ReapIdle(ctx, now.Add(-idleTimeout))
			if err != nil {
				slog.Error("reap idle sandboxes", "error", err)
			}
			for _, workspaceID := range destroyed {
				slog.Info("destroyed idle sandbox", "workspace_id", workspaceID)
			}
		}
	}
}
