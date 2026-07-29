package main

import "time"

type idleHostController struct {
	timeout   time.Duration
	idleSince time.Time
}

func (controller *idleHostController) observe(
	now time.Time,
	activeSandboxes int,
) bool {
	if controller.timeout <= 0 {
		return false
	}
	if activeSandboxes > 0 {
		controller.idleSince = time.Time{}
		return false
	}
	if controller.idleSince.IsZero() {
		controller.idleSince = now
		return false
	}
	return !now.Before(controller.idleSince.Add(controller.timeout))
}

func (controller *idleHostController) reset(now time.Time) {
	controller.idleSince = now
}
