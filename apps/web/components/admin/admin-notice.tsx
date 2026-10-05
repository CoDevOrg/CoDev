"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";

export type AdminNoticeResult = { ok: boolean; message: string } | null;

export function AdminNotice({ result }: { result: AdminNoticeResult }) {
  if (!result) return null;
  return (
    <Alert
      className="admin-action-notice my-2"
      variant={result.ok ? "default" : "destructive"}
      role={result.ok ? "status" : "alert"}
    >
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  );
}
