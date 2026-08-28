"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Bot,
  Check,
  FileCode2,
  Hash,
  Lock,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Sparkles,
  X,
} from "lucide-react";

import {
  AGENT_MENTION,
  channelSlugSchema,
  type ChannelMessage,
  type ChannelSummary,
  type TeamMemberPresence,
  type TeamRoster,
} from "@codev/contracts";
import {
  CHANNEL_MESSAGE_POLL_MS,
  TEAM_CHAT_POLL_MS,
  authorNameFor,
  describeMemberFocus,
  displayName,
  formatChatTime,
  groupChannelMessages,
} from "@/lib/team-chat-view";
import {
  createChannel,
  fetchChannelMessages,
  fetchChannels,
  fetchTeamRoster,
  saveMemberStatus,
  sendChannelMessage,
  type AgentDispatchResult,
} from "@/lib/team-chat-client";

const COLLAPSED_STORAGE_KEY = "codev.team-rail.collapsed";
const STATUS_EMOJI = ["🛠️", "🔍", "🐛", "📝", "🚀", "☕"];

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function readStoredCollapsed() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
}

/**
 * Polls the roster, the channel list, and the open conversation. Chat has to
 * feel live without holding a socket open per workspace member, so each
 * surface refreshes at the slowest rate that still reads as immediate.
 */
export function useWorkspaceTeam(workspaceId: string) {
  const [roster, setRoster] = useState<TeamRoster | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshRail = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [nextRoster, nextChannels] = await Promise.all([
          fetchTeamRoster(workspaceId, signal),
          fetchChannels(workspaceId, signal),
        ]);
        setRoster(nextRoster);
        setChannels(nextChannels);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Team chat is offline.",
        );
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const initialRefresh = window.setTimeout(() => {
      void refreshRail(controller.signal);
    }, 0);
    const timer = setInterval(() => {
      void refreshRail(controller.signal);
    }, TEAM_CHAT_POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(initialRefresh);
      clearInterval(timer);
    };
  }, [refreshRail]);

  const refreshMessages = useCallback(
    async (channelId: string, signal?: AbortSignal) => {
      try {
        setMessages(await fetchChannelMessages(workspaceId, channelId, signal));
      } catch {
        // Keep the transcript we already have; the next tick may succeed.
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!activeChannelId) return;
    const controller = new AbortController();
    const initialRefresh = window.setTimeout(() => {
      void refreshMessages(activeChannelId, controller.signal);
    }, 0);
    const timer = setInterval(() => {
      void refreshMessages(activeChannelId, controller.signal);
    }, CHANNEL_MESSAGE_POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(initialRefresh);
      clearInterval(timer);
    };
  }, [activeChannelId, refreshMessages]);

  const openChannel = useCallback((channelId: string | null) => {
    setActiveChannelId(channelId);
    if (!channelId) setMessages([]);
    // Opening marks the channel read server-side, so clear the badge now
    // rather than waiting a poll cycle for it to catch up.
    if (channelId) {
      setChannels((current) =>
        current.map((channel) =>
          channel.id === channelId ? { ...channel, unreadCount: 0 } : channel,
        ),
      );
    }
  }, []);

  return {
    roster,
    channels,
    messages,
    activeChannelId,
    error,
    openChannel,
    setMessages,
    refreshRail,
  };
}

export function MemberAvatar({
  name,
  avatarUrl,
  online,
  size = 28,
}: {
  name: string;
  avatarUrl: string | null;
  online: boolean;
  size?: number;
}) {
  return (
    <span
      className={`team-avatar${online ? " is-online" : ""}`}
      style={{ width: size, height: size }}
      title={name}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- member avatars come from arbitrary provider CDNs
        <img alt="" src={avatarUrl} />
      ) : (
        <span className="team-avatar-initials">{initialsFor(name)}</span>
      )}
    </span>
  );
}

function FocusLine({ member }: { member: TeamMemberPresence }) {
  const focus = describeMemberFocus(member);
  const Icon =
    focus.kind === "agent"
      ? Sparkles
      : focus.kind === "file"
        ? FileCode2
        : null;
  return (
    <span className={`team-focus is-${focus.kind}`}>
      {member.emoji && focus.kind === "headline" ? (
        <span aria-hidden>{member.emoji}</span>
      ) : Icon ? (
        <Icon aria-hidden size={11} />
      ) : null}
      <span className="team-focus-text">{focus.text}</span>
    </span>
  );
}

function StatusComposer({
  member,
  onSave,
}: {
  member: TeamMemberPresence;
  onSave: (headline: string | null, emoji: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(member.headline ?? "");
  const [emoji, setEmoji] = useState(member.emoji ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(headline.trim() || null, emoji || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        className="team-status-trigger"
        onClick={() => {
          setHeadline(member.headline ?? "");
          setEmoji(member.emoji ?? "");
          setEditing(true);
        }}
        type="button"
      >
        <MemberAvatar
          avatarUrl={member.user.avatarUrl}
          name={displayName(member)}
          online={member.online}
          size={32}
        />
        <span className="team-status-copy">
          <strong>{displayName(member)}</strong>
          <span className="team-status-hint">
            {member.headline
              ? `${member.emoji ? `${member.emoji} ` : ""}${member.headline}`
              : "What are you working on?"}
          </span>
        </span>
      </button>
    );
  }

  return (
    <form className="team-status-form" onSubmit={submit}>
      <div className="team-status-emoji" role="group" aria-label="Status emoji">
        {STATUS_EMOJI.map((option) => (
          <button
            aria-pressed={emoji === option}
            className={`team-status-emoji-option${emoji === option ? " is-selected" : ""}`}
            key={option}
            onClick={() => setEmoji(emoji === option ? "" : option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      <div className="team-status-row">
        <input
          aria-label="Your status"
          autoFocus
          maxLength={120}
          onChange={(event) => setHeadline(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
          placeholder="Reviewing the auth refactor"
          value={headline}
        />
        <button
          aria-label="Save status"
          className="team-status-save"
          disabled={saving}
          type="submit"
        >
          <Check aria-hidden size={13} />
        </button>
      </div>
    </form>
  );
}

function CreateChannelForm({
  onCreate,
}: {
  onCreate: (slug: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = channelSlugSchema.safeParse(
      slug.trim().replace(/^#/, "").replace(/\s+/g, "-").toLowerCase(),
    );
    if (!parsed.success) {
      setError("Use lowercase letters, numbers and hyphens.");
      return;
    }
    setBusy(true);
    const failure = await onCreate(parsed.data);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setSlug("");
    setError(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        className="team-channel-add"
        onClick={() => setOpen(true)}
        type="button"
      >
        <MessageSquarePlus aria-hidden size={13} />
        New channel
      </button>
    );
  }

  return (
    <form className="team-channel-form" onSubmit={submit}>
      <div className="team-channel-form-row">
        <span aria-hidden>#</span>
        <input
          aria-label="New channel name"
          autoFocus
          maxLength={48}
          onChange={(event) => setSlug(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="deploys"
          value={slug}
        />
        <button disabled={busy} type="submit">
          Create
        </button>
      </div>
      {error ? <p className="team-channel-form-error">{error}</p> : null}
    </form>
  );
}

export function TeamRailView({
  roster,
  channels,
  activeChannelId,
  canCreateChannel,
  collapsed,
  error,
  onToggleCollapsed,
  onSelectChannel,
  onCreateChannel,
  onSaveStatus,
}: {
  roster: TeamRoster | null;
  channels: ChannelSummary[];
  activeChannelId: string | null;
  canCreateChannel: boolean;
  collapsed: boolean;
  error: string | null;
  onToggleCollapsed: () => void;
  onSelectChannel: (channelId: string) => void;
  onCreateChannel: (slug: string) => Promise<string | null>;
  onSaveStatus: (
    headline: string | null,
    emoji: string | null,
  ) => Promise<void>;
}) {
  const viewer = roster?.members.find((member) => member.isViewer) ?? null;
  const teammates = roster?.members.filter((member) => !member.isViewer) ?? [];
  const onlineCount =
    roster?.members.filter((member) => member.online).length ?? 0;
  const unreadTotal = channels.reduce(
    (total, channel) => total + channel.unreadCount,
    0,
  );

  if (collapsed) {
    return (
      <aside aria-label="Team" className="team-rail is-collapsed">
        <button
          aria-label="Show team panel"
          className="team-rail-expand"
          onClick={onToggleCollapsed}
          type="button"
        >
          <PanelLeftOpen aria-hidden size={15} />
          {unreadTotal > 0 ? (
            <span className="team-rail-expand-badge">{unreadTotal}</span>
          ) : null}
        </button>
      </aside>
    );
  }

  return (
    <aside aria-label="Team" className="team-rail">
      <header className="team-rail-head">
        <div>
          <p className="team-rail-kicker">Workspace team</p>
          <h2>
            People
            <span
              className="team-rail-online"
              aria-label={`${onlineCount} here now`}
            >
              {onlineCount} here
            </span>
          </h2>
        </div>
        <button
          aria-label="Hide team panel"
          className="team-rail-collapse"
          onClick={onToggleCollapsed}
          type="button"
        >
          <PanelLeftClose aria-hidden size={15} />
        </button>
      </header>

      {error ? <p className="team-rail-error">{error}</p> : null}

      {viewer ? <StatusComposer member={viewer} onSave={onSaveStatus} /> : null}

      <ul className="team-people">
        {teammates.map((member) => (
          <li className="team-person" key={member.user.id}>
            <MemberAvatar
              avatarUrl={member.user.avatarUrl}
              name={displayName(member)}
              online={member.online}
            />
            <div className="team-person-copy">
              <span className="team-person-name">
                {displayName(member)}
                <em>{member.accessRole.replace("_", " ")}</em>
              </span>
              <FocusLine member={member} />
            </div>
          </li>
        ))}
        {teammates.length === 0 ? (
          <li className="team-people-empty">
            You are the only member. Use Share to invite your team.
          </li>
        ) : null}
      </ul>

      {roster && roster.agents.length > 0 ? (
        <ul className="team-agents">
          {roster.agents.map((agent) => (
            <li className="team-agent" key={agent.sessionId}>
              <span className="team-agent-mark">
                <Bot aria-hidden size={13} />
              </span>
              <div className="team-person-copy">
                <span className="team-person-name">
                  {agent.name}
                  <em>{agent.provider}</em>
                </span>
                <span className="team-focus is-agent">
                  <span className="team-focus-text">{agent.currentTask}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="team-channels">
        <div className="team-channels-head">
          <h3>Channels</h3>
        </div>
        <ul>
          {channels.map((channel) => (
            <li key={channel.id}>
              <button
                aria-current={channel.id === activeChannelId}
                className={`team-channel${channel.id === activeChannelId ? " is-active" : ""}${channel.unreadCount > 0 ? " is-unread" : ""}`}
                onClick={() => onSelectChannel(channel.id)}
                type="button"
              >
                <span className="team-channel-name">
                  <Hash aria-hidden size={12} />
                  {channel.slug}
                  {channel.agentAccess ? null : (
                    <span title="Closed to agents">
                      <Lock aria-hidden size={10} />
                    </span>
                  )}
                </span>
                {channel.unreadCount > 0 ? (
                  <span
                    className="team-channel-unread"
                    aria-label={`${channel.unreadCount} unread`}
                  >
                    {channel.unreadCount}
                  </span>
                ) : null}
                {channel.lastMessagePreview ? (
                  <span className="team-channel-preview">
                    {channel.lastMessageAuthor
                      ? `${channel.lastMessageAuthor}: `
                      : ""}
                    {channel.lastMessagePreview}
                  </span>
                ) : (
                  <span className="team-channel-preview is-empty">
                    No messages yet
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {canCreateChannel ? (
          <CreateChannelForm onCreate={onCreateChannel} />
        ) : null}
        <p className="team-rail-foot">
          Mention <code>{AGENT_MENTION}</code> in a channel to bring the coding
          agent into the conversation.
        </p>
      </div>
    </aside>
  );
}

function MessageBody({ body }: { body: string }) {
  const parts = body.split(/(@[A-Za-z0-9][A-Za-z0-9-]*)/g);
  return (
    <p className="team-message-body">
      {parts.map((part, index) =>
        part.startsWith("@") ? (
          <span
            className={`team-mention${part.toLowerCase() === AGENT_MENTION ? " is-agent" : ""}`}
            key={`${part}-${index}`}
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export function ChannelConversation({
  channel,
  messages,
  notice,
  sending,
  onClose,
  onSend,
}: {
  channel: ChannelSummary;
  messages: ChannelMessage[];
  notice: string | null;
  sending: boolean;
  onClose: () => void;
  onSend: (body: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(() => groupChannelMessages(messages), [messages]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [groups.length, messages.length]);

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft("");
    await onSend(body);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
    if (event.key === "Escape") onClose();
  }

  return (
    <section aria-label={`#${channel.slug}`} className="team-conversation">
      <header className="team-conversation-head">
        <div>
          <h2>
            <Hash aria-hidden size={14} />
            {channel.slug}
          </h2>
          <p>
            {channel.topic ?? "No topic yet."}
            {channel.agentAccess ? (
              <span className="team-conversation-agent">
                <Bot aria-hidden size={11} />
                Agents read this channel
              </span>
            ) : null}
          </p>
        </div>
        <button
          aria-label="Close conversation"
          className="team-conversation-close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden size={15} />
        </button>
      </header>

      <div className="team-messages" ref={scrollRef} role="log">
        {groups.length === 0 ? (
          <p className="team-messages-empty">
            This is the start of #{channel.slug}. Say hello, or mention{" "}
            <code>{AGENT_MENTION}</code> to pull in the coding agent.
          </p>
        ) : null}
        {groups.map((group) => (
          <article
            className={`team-message is-${group.authorKind}`}
            key={group.key}
          >
            {group.authorKind === "member" ? (
              <MemberAvatar
                avatarUrl={group.avatarUrl}
                name={group.authorName}
                online={false}
                size={26}
              />
            ) : (
              <span className="team-agent-mark">
                <Bot aria-hidden size={13} />
              </span>
            )}
            <div className="team-message-copy">
              <p className="team-message-meta">
                <strong>{group.authorName}</strong>
                {group.authorKind === "agent" ? (
                  <span className="team-message-tag">agent</span>
                ) : null}
                <time dateTime={group.createdAt}>
                  {formatChatTime(group.createdAt)}
                </time>
              </p>
              {group.messages.map((message) => (
                <MessageBody body={message.body} key={message.id} />
              ))}
            </div>
          </article>
        ))}
      </div>

      {notice ? <p className="team-conversation-notice">{notice}</p> : null}

      <form
        className="team-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label={`Message #${channel.slug}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message #${channel.slug}`}
          rows={2}
          value={draft}
        />
        <div className="team-composer-actions">
          <button
            className="team-composer-mention"
            onClick={() =>
              setDraft((current) =>
                current.includes(AGENT_MENTION)
                  ? current
                  : `${current}${current && !current.endsWith(" ") ? " " : ""}${AGENT_MENTION} `,
              )
            }
            type="button"
          >
            <Sparkles aria-hidden size={12} />
            Ask the agent
          </button>
          <button
            aria-label="Send message"
            className="team-composer-send"
            disabled={sending || draft.trim().length === 0}
            type="submit"
          >
            <Send aria-hidden size={13} />
          </button>
        </div>
      </form>
    </section>
  );
}

export function WorkspaceTeamPanel({
  workspaceId,
  canCreateChannel = true,
}: {
  workspaceId: string;
  canCreateChannel?: boolean;
}) {
  const {
    roster,
    channels,
    messages,
    activeChannelId,
    error,
    openChannel,
    setMessages,
    refreshRail,
  } = useWorkspaceTeam(workspaceId);
  const [collapsed, setCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const restorePreference = window.setTimeout(() => {
      setCollapsed(readStoredCollapsed());
    }, 0);
    return () => clearTimeout(restorePreference);
  }, []);

  const activeChannel =
    channels.find((channel) => channel.id === activeChannelId) ?? null;

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      if (next) openChannel(null);
      return next;
    });
  }

  async function handleSend(body: string) {
    if (!activeChannel) return;
    setSending(true);
    setNotice(null);
    try {
      const { message, agentDispatch } = await sendChannelMessage(
        workspaceId,
        activeChannel.id,
        body,
      );
      setMessages((current) => [...current, message]);
      setNotice(describeDispatch(agentDispatch));
      void refreshRail();
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "The message was not sent.",
      );
    } finally {
      setSending(false);
    }
  }

  async function handleCreateChannel(slug: string) {
    try {
      const created = await createChannel(workspaceId, { slug });
      await refreshRail();
      openChannel(created.id);
      return null;
    } catch (cause) {
      return cause instanceof Error
        ? cause.message
        : "The channel was not created.";
    }
  }

  async function handleSaveStatus(
    headline: string | null,
    emoji: string | null,
  ) {
    await saveMemberStatus(workspaceId, { headline, emoji });
    await refreshRail();
  }

  return (
    <>
      <TeamRailView
        activeChannelId={activeChannelId}
        canCreateChannel={canCreateChannel}
        channels={channels}
        collapsed={collapsed}
        error={error}
        onCreateChannel={handleCreateChannel}
        onSaveStatus={handleSaveStatus}
        onSelectChannel={openChannel}
        onToggleCollapsed={toggleCollapsed}
        roster={roster}
      />
      {activeChannel ? (
        <ChannelConversation
          channel={activeChannel}
          messages={messages}
          notice={notice}
          onClose={() => {
            setNotice(null);
            openChannel(null);
          }}
          onSend={handleSend}
          sending={sending}
        />
      ) : null}
    </>
  );
}

export function describeDispatch(dispatch: AgentDispatchResult) {
  if (!dispatch) return null;
  return dispatch.dispatched
    ? "Sent to the running agent — its reply will land in this channel."
    : `The agent was not reached: ${dispatch.reason}`;
}

export { authorNameFor };
