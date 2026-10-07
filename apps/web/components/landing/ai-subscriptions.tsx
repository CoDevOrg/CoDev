import {
  ClaudeLogo,
  CodexLogo,
  CursorLogo,
} from "@/components/gen2/provider-logos";
import { Badge } from "@/components/ui/badge";

export function AiSubscriptions() {
  return (
    <div className="lp-ai-subscriptions">
      <p>Bring your own AI subscriptions</p>
      <div
        className="lp-ai-subscription-providers"
        aria-label="Supported AI subscriptions"
      >
        <Badge variant="outline">
          <CodexLogo size={24} />
          OpenAI
        </Badge>
        <Badge variant="outline">
          <ClaudeLogo size={18} />
          Claude
        </Badge>
        <Badge variant="outline">
          <CursorLogo size={18} />
          Cursor
        </Badge>
      </div>
    </div>
  );
}
