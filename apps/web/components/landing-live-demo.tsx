import {
  Check,
  Eye,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Play,
  Users,
} from "lucide-react";

import styles from "@/app/landing.module.css";

const changes = [
  ["parser.ts", "+28", "-6"],
  ["calendarStore.ts", "+23", "-0"],
  ["parser.test.ts", "+41", "-0"],
] as const;

function AgentLane({
  agent,
  owner,
  task,
  prompt,
  file,
  response,
  tone,
}: {
  agent: "Codex" | "Claude";
  owner: string;
  task: string;
  prompt: string;
  file: string;
  response: string;
  tone: "blue" | "orange";
}) {
  return (
    <article
      className={`${styles.agentLane} ${styles[`agentLane${tone}`]}`}
      data-agent={agent.toLowerCase()}
    >
      <header className={styles.agentLaneHeader}>
        <div>
          <span className={styles.agentMark} aria-hidden="true">
            {agent === "Codex" ? "C" : "A"}
          </span>
          <strong>{agent}</strong>
        </div>
        <span className={styles.agentWorking}>
          <i aria-hidden="true" /> Working
        </span>
      </header>

      <div className={styles.agentOwner}>
        <span className={styles.ownerAvatar} aria-hidden="true">
          {owner.slice(0, 1)}
        </span>
        <div>
          <strong>{owner}</strong>
          <span>directing {agent}</span>
        </div>
      </div>

      <div className={styles.agentTask}>
        <span>Task</span>
        <strong>{task}</strong>
      </div>

      <div className={styles.agentPrompt}>
        <MessageSquare aria-hidden="true" />
        <p>{prompt}</p>
      </div>

      <div
        className={styles.codePreview}
        aria-label={`${agent} editing ${file}`}
      >
        <div className={styles.codePreviewHeader}>
          <span>TS</span>
          <strong>{file}</strong>
        </div>
        <pre aria-hidden="true">
          <code>
            <span>42</span> export async function update() {"{"}
            {"\n"}
            <span>43</span> &nbsp;const result = await validate(input)
            {"\n"}
            <mark>
              <span>44</span> &nbsp;return persist(result)
            </mark>
            {"\n"}
            <span>45</span> {"}"}
          </code>
        </pre>
      </div>

      <div className={styles.agentResponse}>
        <span className={styles.responseAgent}>{agent}</span>
        <p className={styles.typingText}>{response}</p>
        <span className={styles.typingCaret} aria-hidden="true" />
      </div>
    </article>
  );
}

export function LandingLiveDemo() {
  return (
    <section
      className={styles.workspaceStage}
      aria-label="Live CoDev workspace with Codex and Claude working in parallel"
    >
      <div className={styles.workspaceTopbar}>
        <div className={styles.workspaceRepo}>
          <span className={styles.workspaceLogo} aria-hidden="true">
            C
          </span>
          <strong>acme / calendar</strong>
          <span className={styles.branchName}>
            <GitBranch aria-hidden="true" /> main
          </span>
        </div>
        <div className={styles.workspacePresence}>
          <div className={styles.presenceFaces} aria-hidden="true">
            <span>Y</span>
            <span>M</span>
          </div>
          <span>
            <i aria-hidden="true" /> 4 online
          </span>
        </div>
      </div>

      <div className={styles.workspaceBody}>
        <aside className={styles.workspaceSidebar} aria-label="Workspace views">
          <p>Workspace</p>
          <span>
            <Eye aria-hidden="true" /> Overview
          </span>
          <span className={styles.workspaceSidebarActive}>
            <Play aria-hidden="true" /> Sessions <b>2</b>
          </span>
          <span>
            <GitPullRequest aria-hidden="true" /> Changes <b>14</b>
          </span>
          <span>
            <Users aria-hidden="true" /> Team
          </span>
        </aside>

        <div className={styles.agentGrid}>
          <AgentLane
            agent="Codex"
            owner="Yousef"
            task="Refactor the event parser"
            prompt="Extract date parsing and add tests for malformed events."
            file="parser.ts"
            response="I found the shared parser. Adding the failing cases now."
            tone="blue"
          />
          <AgentLane
            agent="Claude"
            owner="Maya"
            task="Add calendar color sync"
            prompt="Default new calendars to the team's local color setting."
            file="calendarStore.ts"
            response="The sync path is clear. Updating the store and migration."
            tone="orange"
          />
        </div>

        <aside className={styles.changesPanel} aria-label="Shared code changes">
          <header>
            <div>
              <span>Changes</span>
              <strong>14 files</strong>
            </div>
            <span className={styles.liveBadge}>
              <i aria-hidden="true" /> Live
            </span>
          </header>
          <ul>
            {changes.map(([file, added, removed]) => (
              <li key={file}>
                <span>{file}</span>
                <span>
                  <b>{added}</b> <em>{removed}</em>
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.reviewReady}>
            <Check aria-hidden="true" />
            <div>
              <strong>Ready for review</strong>
              <span>Both agent sessions are visible</span>
            </div>
          </div>
        </aside>
      </div>

      <footer className={styles.workspaceFooter}>
        <span>
          <i aria-hidden="true" /> Codex and Claude are typing at the same time
        </span>
        <p>One repository. Shared context. No duplicate work.</p>
      </footer>
    </section>
  );
}
