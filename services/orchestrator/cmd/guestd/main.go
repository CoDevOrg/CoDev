package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/yousef20920/CoDev/services/orchestrator/internal/guestapi"
)

func main() {
	workspaceRoot := os.Getenv("CODEV_WORKSPACE_ROOT")
	if workspaceRoot == "" {
		workspaceRoot = "/workspace"
	}
	serverHandler, err := guestapi.New(workspaceRoot)
	if err != nil {
		slog.Error("configure guest API", "error", err)
		os.Exit(1)
	}
	listener, err := listenGuest()
	if err != nil {
		slog.Error("listen on guest vsock", "error", err)
		os.Exit(1)
	}

	server := &http.Server{
		Handler:           serverHandler.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("guest daemon listening", "workspace", workspaceRoot, "port", guestPort)
		if err := server.Serve(listener); !errors.Is(err, http.ErrServerClosed) {
			slog.Error("guest daemon stopped unexpectedly", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		slog.Error("guest daemon shutdown", "error", err)
	}
}
