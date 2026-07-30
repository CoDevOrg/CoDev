"use client";

export function PreviewPane({ className = "" }: { className?: string }) {
  return (
    <section
      className={`preview-pane ${className}`.trim()}
      aria-label="Site preview"
    >
      <div className="preview-pane-head">
        <span>Preview</span>
        <span className="preview-pane-badge">Placeholder</span>
      </div>
      <div className="preview-pane-empty">
        <strong>No site yet</strong>
        <p>
          When the workspace has a runnable site, a live preview will appear
          here.
        </p>
      </div>
    </section>
  );
}
