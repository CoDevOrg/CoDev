//go:build !linux

package sandbox

import "errors"

func NewFirecrackerBackend(_ FirecrackerConfig) (Backend, error) {
	return nil, errors.New("the Firecracker backend requires Linux with KVM")
}
