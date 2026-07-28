package guestapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/creack/pty"
)

const (
	maxBodyBytes   = 2 << 20
	maxOutputBytes = 2 << 20
)

type Server struct {
	workspaceRoot string
}

type FileRequest struct {
	Path string `json:"path"`
}

type WriteFileRequest struct {
	Path             string `json:"path"`
	Contents         string `json:"contents"`
	ExpectedRevision string `json:"expectedRevision"`
}

type FileResponse struct {
	Path     string `json:"path"`
	Contents string `json:"contents"`
	Revision string `json:"revision"`
}

type RevisionResponse struct {
	Revision string `json:"revision"`
}

type ExecRequest struct {
	Command        []string `json:"command"`
	WorkingDir     string   `json:"workingDir"`
	TimeoutSeconds int      `json:"timeoutSeconds"`
	Rows           uint16   `json:"rows"`
	Columns        uint16   `json:"columns"`
}

type ExecResponse struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
}

type GitResponse struct {
	Output string `json:"output"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func New(workspaceRoot string) (*Server, error) {
	root, err := filepath.Abs(workspaceRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace root: %w", err)
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace root symlinks: %w", err)
	}
	return &Server{workspaceRoot: root}, nil
}

func (server *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.health)
	mux.HandleFunc("POST /v1/files/read", server.readFile)
	mux.HandleFunc("POST /v1/files/write", server.writeFile)
	mux.HandleFunc("POST /v1/pty/exec", server.execPTY)
	mux.HandleFunc("GET /v1/git/status", server.gitStatus)
	mux.HandleFunc("GET /v1/git/diff", server.gitDiff)
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Body != nil {
			request.Body = http.MaxBytesReader(writer, request.Body, maxBodyBytes)
		}
		writer.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(writer, request)
	})
}

func (server *Server) health(writer http.ResponseWriter, _ *http.Request) {
	if info, err := os.Stat(server.workspaceRoot); err != nil || !info.IsDir() {
		writeError(writer, http.StatusServiceUnavailable, errors.New("workspace disk is unavailable"))
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "codev-guest",
	})
}

func (server *Server) readFile(writer http.ResponseWriter, request *http.Request) {
	var input FileRequest
	if err := decodeJSON(request.Body, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	path, err := server.resolveExisting(input.Path)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		writeError(writer, status, err)
		return
	}
	if len(contents) > maxBodyBytes {
		writeError(writer, http.StatusRequestEntityTooLarge, errors.New("file exceeds the two MiB limit"))
		return
	}
	writeJSON(writer, http.StatusOK, FileResponse{
		Path:     input.Path,
		Contents: string(contents),
		Revision: revision(contents),
	})
}

func (server *Server) writeFile(writer http.ResponseWriter, request *http.Request) {
	var input WriteFileRequest
	if err := decodeJSON(request.Body, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	if len(input.Contents) > maxBodyBytes {
		writeError(writer, http.StatusRequestEntityTooLarge, errors.New("file exceeds the two MiB limit"))
		return
	}
	path, err := server.resolveForWrite(input.Path)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	current, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		writeError(writer, http.StatusInternalServerError, err)
		return
	}
	currentRevision := "missing"
	if err == nil {
		currentRevision = revision(current)
	}
	if input.ExpectedRevision != currentRevision {
		writeError(writer, http.StatusConflict, fmt.Errorf(
			"revision mismatch: current revision is %s",
			currentRevision,
		))
		return
	}
	if err := atomicWrite(path, []byte(input.Contents)); err != nil {
		writeError(writer, http.StatusInternalServerError, err)
		return
	}
	writeJSON(writer, http.StatusOK, RevisionResponse{
		Revision: revision([]byte(input.Contents)),
	})
}

func (server *Server) execPTY(writer http.ResponseWriter, request *http.Request) {
	var input ExecRequest
	if err := decodeJSON(request.Body, &input); err != nil {
		writeError(writer, http.StatusBadRequest, err)
		return
	}
	if len(input.Command) == 0 || len(input.Command) > 32 {
		writeError(writer, http.StatusBadRequest, errors.New("command must contain between 1 and 32 arguments"))
		return
	}
	timeout := input.TimeoutSeconds
	if timeout <= 0 {
		timeout = 30
	}
	if timeout > 60 {
		writeError(writer, http.StatusBadRequest, errors.New("command timeout exceeds 60 seconds"))
		return
	}
	workingDirectory := server.workspaceRoot
	if input.WorkingDir != "" {
		var err error
		workingDirectory, err = server.resolveExisting(input.WorkingDir)
		if err != nil {
			writeError(writer, http.StatusBadRequest, err)
			return
		}
	}

	ctx, cancel := context.WithTimeout(request.Context(), time.Duration(timeout)*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, input.Command[0], input.Command[1:]...)
	command.Dir = workingDirectory
	command.Env = append(os.Environ(), "TERM=xterm-256color")
	rows := input.Rows
	if rows == 0 {
		rows = 24
	}
	columns := input.Columns
	if columns == 0 {
		columns = 80
	}
	terminal, err := pty.StartWithSize(command, &pty.Winsize{Rows: rows, Cols: columns})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err)
		return
	}

	output := &limitedBuffer{limit: maxOutputBytes}
	_, copyErr := io.Copy(output, terminal)
	_ = terminal.Close()
	waitErr := command.Wait()
	if errors.Is(copyErr, errOutputLimit) {
		writeError(writer, http.StatusRequestEntityTooLarge, copyErr)
		return
	}
	if ctx.Err() == context.DeadlineExceeded {
		writeError(writer, http.StatusRequestTimeout, errors.New("command timed out"))
		return
	}
	exitCode := 0
	if waitErr != nil {
		var exitError *exec.ExitError
		if !errors.As(waitErr, &exitError) {
			writeError(writer, http.StatusInternalServerError, waitErr)
			return
		}
		exitCode = exitError.ExitCode()
	}
	writeJSON(writer, http.StatusOK, ExecResponse{
		Output:   output.String(),
		ExitCode: exitCode,
	})
}

func (server *Server) gitStatus(writer http.ResponseWriter, request *http.Request) {
	server.runGit(writer, request, "status", "--porcelain=v1", "--branch")
}

func (server *Server) gitDiff(writer http.ResponseWriter, request *http.Request) {
	server.runGit(writer, request, "diff", "--no-ext-diff", "--")
}

func (server *Server) runGit(writer http.ResponseWriter, request *http.Request, arguments ...string) {
	ctx, cancel := context.WithTimeout(request.Context(), 30*time.Second)
	defer cancel()
	commandArguments := append([]string{"-C", server.workspaceRoot}, arguments...)
	command := exec.CommandContext(ctx, "git", commandArguments...)
	output, err := command.Output()
	if ctx.Err() == context.DeadlineExceeded {
		writeError(writer, http.StatusRequestTimeout, errors.New("git command timed out"))
		return
	}
	if len(output) > maxOutputBytes {
		writeError(writer, http.StatusRequestEntityTooLarge, errors.New("git output exceeds the two MiB limit"))
		return
	}
	if err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			writeError(writer, http.StatusConflict, errors.New(strings.TrimSpace(string(exitError.Stderr))))
			return
		}
		writeError(writer, http.StatusInternalServerError, err)
		return
	}
	writeJSON(writer, http.StatusOK, GitResponse{Output: string(output)})
}

func (server *Server) resolveExisting(relativePath string) (string, error) {
	candidate, err := server.cleanJoin(relativePath)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", err
	}
	if !withinRoot(server.workspaceRoot, resolved) {
		return "", errors.New("path escapes the workspace")
	}
	return resolved, nil
}

func (server *Server) resolveForWrite(relativePath string) (string, error) {
	candidate, err := server.cleanJoin(relativePath)
	if err != nil {
		return "", err
	}
	parent := filepath.Dir(candidate)
	resolvedParent, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return "", err
	}
	if !withinRoot(server.workspaceRoot, resolvedParent) {
		return "", errors.New("path escapes the workspace")
	}
	return filepath.Join(resolvedParent, filepath.Base(candidate)), nil
}

func (server *Server) cleanJoin(relativePath string) (string, error) {
	if relativePath == "" || filepath.IsAbs(relativePath) || strings.ContainsRune(relativePath, '\x00') {
		return "", errors.New("path must be a non-empty workspace-relative path")
	}
	candidate := filepath.Join(server.workspaceRoot, filepath.Clean(relativePath))
	if !withinRoot(server.workspaceRoot, candidate) {
		return "", errors.New("path escapes the workspace")
	}
	return candidate, nil
}

func withinRoot(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func atomicWrite(path string, contents []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".codev-write-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(contents); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func revision(contents []byte) string {
	sum := sha256.Sum256(contents)
	return hex.EncodeToString(sum[:])
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

func writeError(writer http.ResponseWriter, status int, err error) {
	writeJSON(writer, status, errorResponse{Error: err.Error()})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

var errOutputLimit = errors.New("command output exceeds the two MiB limit")

type limitedBuffer struct {
	bytes.Buffer
	limit int
}

func (buffer *limitedBuffer) Write(value []byte) (int, error) {
	remaining := buffer.limit - buffer.Len()
	if remaining <= 0 {
		return 0, errOutputLimit
	}
	if len(value) > remaining {
		_, _ = buffer.Buffer.Write(value[:remaining])
		return remaining, errOutputLimit
	}
	return buffer.Buffer.Write(value)
}

func (buffer *limitedBuffer) String() string {
	return buffer.Buffer.String()
}

func exitCode(errorValue error) int {
	if errorValue == nil {
		return 0
	}
	var exitError *exec.ExitError
	if errors.As(errorValue, &exitError) {
		return exitError.ExitCode()
	}
	code, _ := strconv.Atoi(errorValue.Error())
	return code
}
