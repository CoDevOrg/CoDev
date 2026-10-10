"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Shown exactly once, right after the codes are generated. */
export function RecoveryCodes({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = `CoDev recovery codes\nEach code works once.\n\n${codes.join("\n")}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: "codev-recovery-codes.txt",
    });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert role="status">
        <AlertTitle>Save your recovery codes</AlertTitle>
        <AlertDescription>
          If you lose your authenticator, each code signs you in once. Store
          them in a password manager. You will not see them again.
        </AlertDescription>
      </Alert>
      <ol
        aria-label="Recovery codes"
        className="m-0 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 rounded-lg border border-border bg-muted/40 p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li className="whitespace-nowrap select-all" key={code}>
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button onClick={copy} size="sm" type="button" variant="outline">
          {copied ? (
            <Check aria-hidden data-icon="inline-start" />
          ) : (
            <Copy aria-hidden data-icon="inline-start" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button onClick={download} size="sm" type="button" variant="outline">
          <Download aria-hidden data-icon="inline-start" />
          Download
        </Button>
        <Button onClick={onDone} size="sm" type="button">
          I saved my codes
        </Button>
      </div>
    </div>
  );
}
