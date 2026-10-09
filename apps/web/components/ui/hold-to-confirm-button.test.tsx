import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HoldToConfirmButton } from "./hold-to-confirm-button";

describe("HoldToConfirmButton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const renderButton = (onConfirm = vi.fn(), disabled = false) => {
    render(
      <HoldToConfirmButton onConfirm={onConfirm} disabled={disabled}>
        Hold to delete
      </HoldToConfirmButton>,
    );
    return { onConfirm, button: screen.getByRole("button") };
  };

  it("confirms only after the full hold with a pointer", () => {
    const { onConfirm, button } = renderButton();
    fireEvent.pointerDown(button, { button: 0, isPrimary: true });
    act(() => {
      vi.advanceTimersByTime(1_599);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onConfirm).toHaveBeenCalledWith("pointer");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancels when released early", () => {
    const { onConfirm, button } = renderButton();
    fireEvent.pointerDown(button, { button: 0, isPrimary: true });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    fireEvent.pointerUp(button);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels when the pointer drifts out of the button", () => {
    const { onConfirm, button } = renderButton();
    button.getBoundingClientRect = () =>
      ({ left: 0, right: 100, top: 0, bottom: 36 }) as DOMRect;
    fireEvent.pointerDown(button, { button: 0, isPrimary: true });
    fireEvent.pointerMove(button, { clientX: 300, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("works from the keyboard, ignoring auto-repeat and early key release", () => {
    const { onConfirm, button } = renderButton();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: "Enter", repeat: true });
    fireEvent.keyUp(button, { key: "Enter" });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.keyDown(button, { key: " " });
    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(onConfirm).toHaveBeenCalledWith("keyboard");
  });

  it("does nothing while disabled", () => {
    const disabled = renderButton(vi.fn(), true);
    fireEvent.pointerDown(disabled.button, { button: 0, isPrimary: true });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(disabled.onConfirm).not.toHaveBeenCalled();
  });
});
