"use client";

import { useState } from "react";

import { presenceEventSchema, type PresenceEvent } from "@codev/contracts";

import styles from "@/app/verification/b0-2/fixture.module.css";

const workspaceId = "f2100000-0000-4000-8000-000000000001";
const filePath = "src/hello.ts";

const fixtures = [
  {
    id: "f2100000-0000-4000-8000-000000000011",
    name: "Alex Morgan",
    initials: "AM",
    cursor: { anchor: 24, head: 24 },
  },
  {
    id: "f2100000-0000-4000-8000-000000000012",
    name: "Jordan Lee",
    initials: "JL",
    cursor: { anchor: 48, head: 62 },
  },
] as const;

type FixtureState = {
  joined: boolean;
  activePath: string | null;
  cursor: (typeof fixtures)[number]["cursor"] | null;
};

type PresenceEventType = PresenceEvent["type"];

function eventId(sequence: number) {
  return `f2100000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function createEvent<T extends PresenceEventType>(
  sequence: number,
  type: T,
  data: Extract<PresenceEvent, { type: T }>["data"],
) {
  return presenceEventSchema.parse({
    id: eventId(sequence),
    workspaceId,
    sequence,
    createdAt: `2026-08-11T17:20:${String(sequence).padStart(2, "0")}.000Z`,
    type,
    data,
  });
}

const initialState = Object.fromEntries(
  fixtures.map((fixture) => [
    fixture.id,
    { joined: false, activePath: null, cursor: null },
  ]),
) as Record<string, FixtureState>;

export function PresenceEventsFixture() {
  const [members, setMembers] = useState(initialState);
  const [events, setEvents] = useState<PresenceEvent[]>([]);

  function join(fixture: (typeof fixtures)[number]) {
    if (members[fixture.id]?.joined) return;
    const nextSequence = events.length + 1;
    const joinedState: FixtureState = {
      joined: true,
      activePath: filePath,
      cursor: fixture.cursor,
    };
    setMembers((current) => ({ ...current, [fixture.id]: joinedState }));
    setEvents((current) => [
      ...current,
      createEvent(nextSequence, "presence.joined", {
        userId: fixture.id,
        worktreeId: null,
        activePath: null,
        cursor: null,
      }),
      createEvent(nextSequence + 1, "presence.active_file.changed", {
        userId: fixture.id,
        path: filePath,
        previousPath: null,
      }),
      createEvent(nextSequence + 2, "presence.cursor.changed", {
        userId: fixture.id,
        path: filePath,
        cursor: fixture.cursor,
      }),
    ]);
  }

  function leave(fixture: (typeof fixtures)[number]) {
    const currentState = members[fixture.id];
    if (!currentState?.joined) return;
    setMembers((current) => ({
      ...current,
      [fixture.id]: { ...currentState, joined: false },
    }));
    setEvents((current) => [
      ...current,
      createEvent(current.length + 1, "presence.left", {
        userId: fixture.id,
        worktreeId: null,
        activePath: currentState.activePath,
        cursor: currentState.cursor,
        reason: "leave",
      }),
    ]);
  }

  const joinedMembers = fixtures.filter(
    (fixture) => members[fixture.id]?.joined,
  );
  const bothPresent = joinedMembers.length === fixtures.length;

  return (
    <section
      className={`${styles.card} ${styles.presenceEvents}`}
      aria-labelledby="presence-events-heading"
    >
      <div className={styles.cardHeading}>
        <div>
          <span className={styles.kicker}>F2.1 · durable presence</span>
          <h2 id="presence-events-heading">Two fixtures, one file</h2>
        </div>
        <span className={styles.count}>{bothPresent ? "Live" : "Join"}</span>
      </div>

      <p className={styles.presenceIntro}>
        Join both fixtures to record named presence, the active file, and cursor
        state in one ordered event stream.
      </p>

      <div
        className={styles.presenceFixtureList}
        aria-label="Presence fixtures"
      >
        {fixtures.map((fixture) => {
          const state = members[fixture.id] ?? {
            joined: false,
            activePath: null,
            cursor: null,
          };
          return (
            <article
              className={styles.presenceFixture}
              key={fixture.id}
              aria-label={`${fixture.name} presence`}
            >
              <div className={styles.presenceFixtureIdentity}>
                <span
                  className={`${styles.presenceDot} ${state.joined ? "" : styles.presenceOffline}`}
                  aria-hidden="true"
                />
                <span className={styles.avatar} aria-hidden="true">
                  {fixture.initials}
                </span>
                <div>
                  <strong>{fixture.name}</strong>
                  <span>{state.joined ? "present in file" : "not joined"}</span>
                </div>
              </div>
              <button
                className={styles.fixtureAction}
                type="button"
                onClick={() => (state.joined ? leave(fixture) : join(fixture))}
              >
                {state.joined ? "Leave file" : "Join file"}
              </button>
            </article>
          );
        })}
      </div>

      <div
        className={styles.presenceStateGrid}
        aria-label="Shared presence state"
      >
        <div>
          <span className={styles.label}>Active file</span>
          <code>{joinedMembers.length ? filePath : "—"}</code>
        </div>
        <div>
          <span className={styles.label}>Cursors</span>
          <strong>
            {joinedMembers.length
              ? joinedMembers
                  .map((fixture) => fixture.name.split(" ")[0])
                  .join(" · ")
              : "No active cursors"}
          </strong>
        </div>
      </div>

      <div
        className={styles.presenceEventLog}
        aria-label="Durable presence events"
      >
        <div className={styles.presenceEventLogHeader}>
          <span className={styles.label}>Durable event stream</span>
          <span>{events.length} events</span>
        </div>
        {events.length ? (
          events.map((event) => (
            <div className={styles.presenceEventRow} key={event.id}>
              <span>#{event.sequence}</span>
              <code>{event.type}</code>
              <span>
                {
                  fixtures.find((fixture) => fixture.id === event.data.userId)
                    ?.name
                }
              </span>
            </div>
          ))
        ) : (
          <p className={styles.note}>No presence transitions recorded yet.</p>
        )}
      </div>

      <p className={styles.viewerStatus} role="status">
        {bothPresent
          ? "Both fixtures are present in src/hello.ts with durable cursor state."
          : joinedMembers.length
            ? "One fixture is present. Join the second fixture to see shared presence."
            : "Join Alex and Jordan to begin the presence event stream."}
      </p>
    </section>
  );
}
