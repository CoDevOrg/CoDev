import { Check, Circle } from "lucide-react";

import { getNewAccountPasswordRequirements } from "@/lib/auth/password-policy";
import { cn } from "@/lib/platform/utils";

export function PasswordRequirements({ password }: { password: string }) {
  return (
    <ul
      aria-label="Password requirements"
      className="m-0 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2"
    >
      {getNewAccountPasswordRequirements(password).map((requirement) => (
        <li
          className={cn(
            "flex items-center gap-1.5",
            requirement.met ? "text-foreground" : "text-muted-foreground",
          )}
          key={requirement.id}
        >
          {requirement.met ? (
            <Check aria-hidden className="size-3.5 shrink-0" />
          ) : (
            <Circle aria-hidden className="size-3.5 shrink-0" />
          )}
          {requirement.label}
        </li>
      ))}
    </ul>
  );
}
