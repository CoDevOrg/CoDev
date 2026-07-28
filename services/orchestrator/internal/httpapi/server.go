package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/yousef20920/CoDev/services/orchestrator/internal/sandbox"
)

const maxRequestBytes = 1 << 20

var (
	workspaceIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	commitSHAPattern   = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

type Server struct {
	backend sandbox.Backend
	now     func() time.Time
}

type errorResponse struct {
	Error string `json:"error"`
}

type fileRequest struct {
	Path string `json:"path"`
}

type writeFileRequest struct {
	Path             string `json:"path"`
	Contents         string `json:"contents"`
	ExpectedRevision string `json:"expectedRevision"`
}

func New(backend sandbox.Backend) *Server {
	return &Server{backend: backend, now: time.Now}
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.health)
	mux.HandleFunc("POST /v1/sandboxes", server.createSandbox)
	mux.HandleFunc("GET /v1/sandboxes/{workspaceID}", server.getSandbox)
	mux.HandleFunc("POST /v1/sandboxes/{workspaceID}/activity", server.touchSandbox)
	mux.HandleFunc("DELETE /v1/sandboxes/{workspaceID}", server.destroySandbox)
	mux.HandleFunc("POST /v1/sandboxes/{workspaceID}/files/read", server.readFile)
	mux.HandleFunc("POST /v1/sandboxes/{workspaceID}/files/write", server.writeFile)
	mux.HandleFunc("POST /v1/sandboxes/{workspaceID}/pty/exec", server.execPTY)
	mux.HandleFunc("GET /v1/sandboxes/{workspaceID}/git/status", server.gitStatus)
	mux.HandleFunc("GET /v1/sandboxes/{workspaceID}/git/diff", server.gitDiff)
	return requestLimits(mux)
}

func requestLimits(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Body != nil {
			request.Body = http.MaxBytesReader(writer, request.Body, maxRequestBytes)
		}
		writer.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(writer, request)
	})
}

func (server *Server) health(writer http.ResponseWriter, request *http.Request) {
	if err := server.backend.Health(request.Context()); err != nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]string{
			"status":  "degraded",
			"service": "codev-orchestrator",
			"error":   err.Error(),
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "codev-orchestrator",
	})
}

func (server *Server) createSandbox(writer http.ResponseWriter, request *http.Request) {
	var input sandbox.CreateRequest
	if err := decodeJSON(request.Body, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	if err := validateCreateRequest(input, server.now().UTC()); err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}

	instance, err := server.backend.Create(request.Context(), input)
	if err != nil {
		writeBackendError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{"sandbox": instance})
}

func (server *Server) getSandbox(writer http.ResponseWriter, request *http.Request) {
	workspaceID := request.PathValue("workspaceID")
	if !workspaceIDPattern.MatchString(workspaceID) {
		writeError(writer, http.StatusBadRequest, errors.New("invalid workspace ID"))
		return
	}
	instance, err := server.backend.Get(request.Context(), workspaceID)
	if err != nil {
		writeBackendError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"sandbox": instance})
}

func (server *Server) touchSandbox(writer http.ResponseWriter, request *http.Request) {
	workspaceID := request.PathValue("workspaceID")
	if !workspaceIDPattern.MatchString(workspaceID) {
		writeError(writer, http.StatusBadRequest, errors.New("invalid workspace ID"))
		return
	}
	instance, err := server.backend.Touch(request.Context(), workspaceID)
	if err != nil {
		writeBackendError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"sandbox": instance})
}

func (server *Server) destroySandbox(writer http.ResponseWriter, request *http.Request) {
	workspaceID := request.PathValue("workspaceID")
	if !workspaceIDPattern.MatchString(workspaceID) {
		writeError(writer, http.StatusBadRequest, errors.New("invalid workspace ID"))
		return
	}
	if err := server.backend.Destroy(request.Context(), workspaceID); err != nil {
		writeBackendError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) readFile(writer http.ResponseWriter, request *http.Request) {
	workspaceID, ok := validWorkspaceID(writer, request)
	if !ok {
		return
	}
	var input fileRequest
	if err := decodeJSON(request.Body, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	file, err := server.backend.ReadFile(request.Context(), workspaceID, input.Path)
	if err != nil {
		writeBackendError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"file": file})
}

func (server *Server) writeFile(writer http.ResponseWriter, request *http.Request) {
	workspaceID, ok := validWorkspaceID(writer, request)
	if !ok {
		return
	}
	var input writeFileRequest
	if err := decodeJSON(request.Body, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	revision, err := server.backend.WriteFile(
		request.Context(),
		workspaceID,
		input.Path,
		input.Contents,
		input.ExpectedRevision,
	)
	if err != nil {
		writeBackendError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"revision": revision})
}

func (server *Server) execPTY(writer http.ResponseWriter, request *http.Request) {
	workspaceID, ok := validWorkspaceID(writer, request)
	if !ok {
		return
	}
	var input sandbox.ExecRequest
	if err := decodeJSON(request.Body, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	result, err := server.backend.Exec(request.Context(), workspaceID, input)
	if err != nil {
		writeBackendError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"result": result})
}

func (server *Server) gitStatus(writer http.ResponseWriter, request *http.Request) {
	server.gitOperation(writer, request, server.backend.GitStatus)
}

func (server *Server) gitDiff(writer http.ResponseWriter, request *http.Request) {
	server.gitOperation(writer, request, server.backend.GitDiff)
}

func (server *Server) gitOperation(
	writer http.ResponseWriter,
	request *http.Request,
	operation func(context.Context, string) (string, error),
) {
	workspaceID, ok := validWorkspaceID(writer, request)
	if !ok {
		return
	}
	output, err := operation(request.Context(), workspaceID)
	if err != nil {
		writeBackendError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"output": output})
}

func validWorkspaceID(writer http.ResponseWriter, request *http.Request) (string, bool) {
	workspaceID := request.PathValue("workspaceID")
	if !workspaceIDPattern.MatchString(workspaceID) {
		writeError(writer, http.StatusBadRequest, errors.New("invalid workspace ID"))
		return "", false
	}
	return workspaceID, true
}

func validateCreateRequest(input sandbox.CreateRequest, now time.Time) error {
	if !workspaceIDPattern.MatchString(input.WorkspaceID) {
		return errors.New("invalid workspace ID")
	}
	if !commitSHAPattern.MatchString(input.BaseSHA) {
		return errors.New("base SHA must contain 40 lowercase hexadecimal characters")
	}
	repositoryURL, err := url.Parse(input.RepositoryURL)
	if err != nil ||
		repositoryURL.Scheme != "https" ||
		repositoryURL.Host != "github.com" ||
		repositoryURL.RawQuery != "" ||
		repositoryURL.Fragment != "" {
		return errors.New("repository URL must be an HTTPS github.com URL")
	}
	path := strings.TrimSuffix(strings.TrimPrefix(repositoryURL.Path, "/"), ".git")
	parts := strings.Split(path, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return errors.New("repository URL must identify one GitHub repository")
	}
	if !input.ExpiresAt.After(now) {
		return errors.New("expiry must be in the future")
	}
	if input.ExpiresAt.After(now.Add(4*time.Hour + time.Minute)) {
		return errors.New("expiry exceeds the four-hour workspace limit")
	}
	return nil
}

func decodeJSON(reader io.Reader, target any) error {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func writeBackendError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sandbox.ErrSandboxNotFound):
		writeError(writer, http.StatusNotFound, err)
	case errors.Is(err, sandbox.ErrCapacityExceeded):
		writeError(writer, http.StatusTooManyRequests, err)
	case errors.Is(err, sandbox.ErrGuestUnavailable):
		writeError(writer, http.StatusServiceUnavailable, err)
	default:
		writeError(writer, http.StatusInternalServerError, err)
	}
}

func writeError(writer http.ResponseWriter, status int, err error) {
	writeJSON(writer, status, errorResponse{Error: err.Error()})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
