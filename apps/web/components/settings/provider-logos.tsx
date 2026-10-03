import {
  ClaudeLogo,
  CodexLogo,
  CursorLogo,
} from "@/components/gen2/provider-logos";

/**
 * Official logos for AI providers across settings and product surfaces.
 */

export function ClaudeMark({ className }: { className?: string }) {
  return <ClaudeLogo className={className} size={20} />;
}

export function OpenAIMark({ className }: { className?: string }) {
  return <CodexLogo className={className} size={20} />;
}

export function CursorMark({ className }: { className?: string }) {
  return <CursorLogo className={className} size={20} />;
}
