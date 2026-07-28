package guestclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/yousef20920/CoDev/services/orchestrator/internal/guestapi"
)

type Client struct {
	httpClient *http.Client
}

func New(vsockPath string, guestPort uint32) *Client {
	transport := &http.Transport{
		DisableKeepAlives: true,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialVsock(ctx, vsockPath, guestPort)
		},
	}
	return &Client{
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   65 * time.Second,
		},
	}
}

func (client *Client) Health(ctx context.Context) error {
	response, err := client.do(ctx, http.MethodGet, "/healthz", nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return responseError(response)
	}
	return nil
}

func (client *Client) ReadFile(ctx context.Context, path string) (guestapi.FileResponse, error) {
	var result guestapi.FileResponse
	err := client.doJSON(ctx, http.MethodPost, "/v1/files/read", guestapi.FileRequest{Path: path}, &result)
	return result, err
}

func (client *Client) WriteFile(
	ctx context.Context,
	request guestapi.WriteFileRequest,
) (guestapi.RevisionResponse, error) {
	var result guestapi.RevisionResponse
	err := client.doJSON(ctx, http.MethodPost, "/v1/files/write", request, &result)
	return result, err
}

func (client *Client) Exec(
	ctx context.Context,
	request guestapi.ExecRequest,
) (guestapi.ExecResponse, error) {
	var result guestapi.ExecResponse
	err := client.doJSON(ctx, http.MethodPost, "/v1/pty/exec", request, &result)
	return result, err
}

func (client *Client) GitStatus(ctx context.Context) (guestapi.GitResponse, error) {
	var result guestapi.GitResponse
	err := client.doJSON(ctx, http.MethodGet, "/v1/git/status", nil, &result)
	return result, err
}

func (client *Client) GitDiff(ctx context.Context) (guestapi.GitResponse, error) {
	var result guestapi.GitResponse
	err := client.doJSON(ctx, http.MethodGet, "/v1/git/diff", nil, &result)
	return result, err
}

func (client *Client) doJSON(
	ctx context.Context,
	method string,
	path string,
	body any,
	target any,
) error {
	response, err := client.do(ctx, method, path, body)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return responseError(response)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 3<<20)).Decode(target); err != nil {
		return fmt.Errorf("decode guest response: %w", err)
	}
	return nil
}

func (client *Client) do(
	ctx context.Context,
	method string,
	path string,
	body any,
) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, "http://guest"+path, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call guest daemon: %w", err)
	}
	return response, nil
}

func dialVsock(ctx context.Context, path string, port uint32) (net.Conn, error) {
	dialer := net.Dialer{}
	connection, err := dialer.DialContext(ctx, "unix", path)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(5 * time.Second)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	if err := connection.SetDeadline(deadline); err != nil {
		_ = connection.Close()
		return nil, err
	}
	if _, err := fmt.Fprintf(connection, "CONNECT %d\n", port); err != nil {
		_ = connection.Close()
		return nil, err
	}
	line, err := bufio.NewReader(connection).ReadString('\n')
	if err != nil {
		_ = connection.Close()
		return nil, err
	}
	if !strings.HasPrefix(line, "OK ") {
		_ = connection.Close()
		return nil, fmt.Errorf("vsock proxy rejected connection: %s", strings.TrimSpace(line))
	}
	if err := connection.SetDeadline(time.Time{}); err != nil {
		_ = connection.Close()
		return nil, err
	}
	return connection, nil
}

func responseError(response *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	var payload struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &payload) == nil && payload.Error != "" {
		return errors.New(payload.Error)
	}
	return fmt.Errorf("guest daemon returned HTTP %d", response.StatusCode)
}
