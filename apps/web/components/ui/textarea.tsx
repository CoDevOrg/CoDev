import * as React from "react";

import { cn } from "@/lib/platform/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "w-full resize-none appearance-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
