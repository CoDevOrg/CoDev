import { Check, Copy, Share2, Sparkles } from "lucide-react";
import "./multiplayer-preview.css";
import "./multiplayer-motion.css";

export function MultiplayerCard() {
  return (
    <div className="lp-triple-card" data-reveal>
      <div className="lp-triple-text">
        <h3 className="lp-triple-title">Invite your team. Build together.</h3>{" "}
        <p className="lp-triple-desc">
          Share a link and work in the same editor and terminal. Follow each
          other’s agent sessions and see changes as they happen.
        </p>
      </div>
      <InvitePreview />
    </div>
  );
}

// A CSS-only loop: share the workspace, copy the link, then a teammate joins
// and edits beside you. Without motion it rests on the joined frame.
function InvitePreview() {
  return (
    <div
      className="lp-feature-preview lp-invite-preview"
      role="img"
      aria-label="A teammate joins from a shared link and edits the same file live"
    >
      <div className="lp-feature-dots" />
      <div className="lp-triple-stage lp-invite-editor">
        <div className="lp-invite-toolbar">
          <span>workspace / api.ts</span>
          <span className="lp-invite-share">
            <Share2 size={11} />
            Share
          </span>
        </div>
        <EditorScene />
        <div className="lp-doc-footer">
          <span className="lp-doc-live-dot" />
          <Swap
            before="You and Claude · ready to build"
            after="3 in room · editing together"
          />
        </div>
        <InvitePopover />
        <span className="lp-invite-pointer">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M1.5 1.5 14 6.6 8.4 8.4 6.6 14Z" />
          </svg>
          <b>You</b>
        </span>
      </div>
    </div>
  );
}

function Swap({ before, after }: { before: string; after: string }) {
  return (
    <span className="lp-invite-swap">
      <span className="lp-invite-before">{before}</span>
      <span className="lp-invite-after">{after}</span>
    </span>
  );
}

function InvitePopover() {
  return (
    <div className="lp-invite-popover">
      <strong>Invite to workspace</strong>
      <p>Anyone with this link can join.</p>
      <div className="lp-invite-link">
        <span>trycodev.com/room/team</span>
        <span className="lp-invite-copy">
          <Copy size={11} />
          <Check size={11} />
        </span>
      </div>
      <small>
        <Swap
          before="Copy the link and send it to your team."
          after="Link copied"
        />
      </small>
    </div>
  );
}

function EditorScene() {
  return (
    <div className="lp-invite-code">
      <div className="lp-invite-presence">
        <Swap
          before="Claude is working…"
          after="Sarah joined · editing api.ts"
        />
        <span className="lp-invite-avatars">
          <span className="lp-invite-avatar lp-invite-you">Y</span>
          <span className="lp-invite-avatar lp-invite-agent">
            <Sparkles size={10} />
          </span>
          <span className="lp-invite-avatar lp-invite-sarah">S</span>
        </span>
      </div>
      <div>
        <i>12</i>
        <span className="lp-invite-keyword">export async function</span>{" "}
        GET(req) &#123;
      </div>
      <div className="lp-invite-edit-line">
        <i>13</i>&nbsp; const ok = <span className="lp-invite-old">true;</span>
        <span className="lp-invite-typed">await rateLimit(req);</span>
        <b className="lp-invite-caret">
          <span>Sarah</span>
        </b>
      </div>
      <div>
        <i>14</i>&nbsp; return Response.json(&#123; ok &#125;);
      </div>
      <div>
        <i>15</i>&#125;
      </div>
    </div>
  );
}
