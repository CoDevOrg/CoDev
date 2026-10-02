import * as React from "react";

import { cn } from "@/lib/platform/utils";

export function Separator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("h-px w-full bg-border", className)}
      role="separator"
      {...props}
    />
  );
}
