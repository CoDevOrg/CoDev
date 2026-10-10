"use client";

import {
  GEN2_AGENT_PROVIDERS,
  type Gen2AgentProviderName,
} from "@codev/contracts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProviderLogo } from "./provider-logos";
import { WorkspaceButton } from "./workspace-button";

/** Asks which connected agent a new chat should use. */
export function ChatProviderPicker({
  open,
  onOpenChange,
  providers,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: Gen2AgentProviderName[];
  onChoose: (provider: Gen2AgentProviderName) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gen2-workspace-surface">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Which provider do you want to use?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Choose the AI provider for this chat.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {GEN2_AGENT_PROVIDERS.filter((entry) =>
            providers.includes(entry.id),
          ).map((entry) => (
            <AlertDialogAction
              key={entry.id}
              asChild
              onClick={() => {
                onOpenChange(false);
                onChoose(entry.id);
              }}
            >
              <WorkspaceButton tone="secondary">
                <ProviderLogo provider={entry.id} size={16} />
                {entry.label}
              </WorkspaceButton>
            </AlertDialogAction>
          ))}
          <AlertDialogCancel asChild>
            <WorkspaceButton tone="ghost">Cancel</WorkspaceButton>
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
