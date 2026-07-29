package main

import (
	"testing"
	"time"
)

func TestIdleHostController(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	controller := idleHostController{timeout: 15 * time.Minute}

	if controller.observe(now, 0) {
		t.Fatal("freshly idle host should not stop")
	}
	if controller.observe(now.Add(14*time.Minute), 0) {
		t.Fatal("host stopped before idle timeout")
	}
	if !controller.observe(now.Add(15*time.Minute), 0) {
		t.Fatal("host did not stop at idle timeout")
	}

	controller.observe(now.Add(16*time.Minute), 1)
	if controller.observe(now.Add(31*time.Minute), 0) {
		t.Fatal("active sandbox should reset idle timer")
	}
	if !controller.observe(now.Add(46*time.Minute), 0) {
		t.Fatal("host did not stop after reset idle timeout")
	}
}

func TestIdleHostControllerDisabled(t *testing.T) {
	t.Parallel()

	controller := idleHostController{}
	if controller.observe(time.Now().Add(24*time.Hour), 0) {
		t.Fatal("disabled controller should never stop the host")
	}
}
