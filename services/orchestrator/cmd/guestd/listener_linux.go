//go:build linux

package main

import (
	"net"

	"github.com/mdlayher/vsock"
)

const guestPort = 52

func listenGuest() (net.Listener, error) {
	return vsock.Listen(guestPort, nil)
}
