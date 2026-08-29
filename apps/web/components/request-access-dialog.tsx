"use client";

import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";

import { RequestAccessForm } from "@/components/request-access-form";

const DIALOG_ID = "request-access-dialog";

function openDialog() {
  const dialog = document.getElementById(DIALOG_ID) as HTMLDialogElement | null;
  if (!dialog || dialog.open) return;

  dialog.showModal();
  window.requestAnimationFrame(() => {
    dialog.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
  });
}

export function RequestAccessDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <dialog
      id={DIALOG_ID}
      ref={dialogRef}
      className="lp-waitlist-dialog"
      aria-labelledby="waitlist-title"
      aria-describedby="waitlist-description"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          event.currentTarget.close();
        }
      }}
    >
      <div className="lp-waitlist-panel">
        <header>
          <div>
            <h2 id="waitlist-title">Get early access.</h2>
            <p id="waitlist-description">Tell us where to send your invite.</p>
          </div>
          <button
            className="lp-dialog-close"
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
          >
            <X aria-hidden="true" size={19} strokeWidth={1.8} />
          </button>
        </header>
        <RequestAccessForm />
      </div>
    </dialog>
  );
}

export function RequestAccessButton({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <button className={className} type="button" onClick={openDialog}>
      {children}
    </button>
  );
}
