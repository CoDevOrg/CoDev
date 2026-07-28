//go:build !linux

package main

import (
	"errors"
	"net"
)

const guestPort = 52

func listenGuest() (net.Listener, error) {
	return nil, errors.New("the guest daemon requires Linux AF_VSOCK support")
}
