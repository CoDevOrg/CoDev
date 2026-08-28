const collaborators = [
  ["Sarah", "Claude", "Checking production logs", "Running"],
  ["David", "Gemini", "Investigating DB saturation", "Running"],
  ["Alex", "Codex", "Reviewing rollback", "Waiting for approval"],
] as const;

export function WorkspacePreview() {
  return (
    <div className="mp-workspace" aria-label="A live CoDev incident room">
      <div className="mp-workspace-bar">
        <div className="mp-window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span className="mp-room-name">payments-incident</span>
        <div
          className="mp-presence"
          aria-label="Three people and three agents online"
        >
          <span className="mp-avatar mp-avatar-sarah">S</span>
          <span className="mp-avatar mp-avatar-david">D</span>
          <span className="mp-avatar mp-avatar-agent">AI</span>
          <b>+3</b>
        </div>
      </div>

      <div className="mp-preview-body">
        <div className="mp-incident-head">
          <div>
            <span>
              <i /> SEV-1 · Active
            </span>
            <h2>Payments incident</h2>
          </div>
          <button type="button" tabIndex={-1}>
            Share room
          </button>
        </div>

        <div className="mp-collaborator-list">
          {collaborators.map(([person, agent, task, status]) => (
            <article key={person}>
              <span className="mp-person-avatar">{person[0]}</span>
              <div>
                <b>{person}</b>
                <p>└─ {agent}</p>
              </div>
              <div>
                <strong>{task}</strong>
                <small>{status}</small>
              </div>
            </article>
          ))}
        </div>

        <div className="mp-preview-summary">
          <div>
            <span>SHARED FINDINGS</span>
            <p>✓ Failures began after deploy 7f3a2c</p>
            <p>✓ Payment provider ruled out</p>
            <p className="is-active">
              ● DB connection pool under investigation
            </p>
          </div>
          <div className="mp-preview-decision">
            <span>DECISION</span>
            <strong>Prepare rollback. Do not execute yet.</strong>
            <small>Approved by Sarah</small>
          </div>
        </div>
      </div>

      <div className="mp-workspace-foot">
        <span>
          <i /> Live shared context
        </span>
        <p>3 people · 3 agents · 1 shared state</p>
      </div>
    </div>
  );
}
