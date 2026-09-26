"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, MessageSquareText, Plus, Search } from "lucide-react";

import type { SharedChatSummary } from "@/lib/chat/shared-chat";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { RoomImportPanel } from "./room-import-panel";

const PROVIDER_STYLE: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  chatgpt: {
    label: "ChatGPT",
    className: "border-teal/30 bg-teal/10 text-teal",
    dot: "bg-teal",
  },
  claude: {
    label: "Claude",
    className: "border-orange/30 bg-orange/10 text-orange",
    dot: "bg-orange",
  },
  codex: {
    label: "Codex",
    className: "border-violet/30 bg-violet/10 text-violet",
    dot: "bg-violet",
  },
};

function providerStyle(sourceProvider: string | null) {
  const key = sourceProvider?.toLowerCase() ?? "";
  return (
    PROVIDER_STYLE[key] ?? {
      label: sourceProvider ?? "Imported",
      className: "border-border bg-muted text-muted-foreground",
      dot: "bg-muted-foreground",
    }
  );
}

function initials(title: string) {
  const [first = "", second = ""] = title.split(/\s+/);
  return (first[0] ?? "").concat(second[0] ?? "").toUpperCase() || "?";
}

const FILTERS = ["all", "chatgpt", "claude", "codex"] as const;
type Filter = (typeof FILTERS)[number];

export function RoomsView({ rooms }: { rooms: SharedChatSummary[] }) {
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const visibleRooms = useMemo(() => {
    return rooms.filter((room) => {
      const matchesFilter =
        filter === "all" ||
        (room.sourceProvider?.toLowerCase() ?? "") === filter;
      const matchesQuery = room.title
        .toLowerCase()
        .includes(query.trim().toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [rooms, filter, query]);

  return (
    <main className="rooms-scope min-h-dvh px-8 py-11 sm:px-12">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-7">
          <div>
            <span className="mb-2 inline-block text-[11px] font-bold tracking-[0.12em] text-primary uppercase">
              Collaborative conversations
            </span>
            <h1 className="m-0 text-[42px] leading-[1.03] font-semibold tracking-tight">
              Rooms
            </h1>
            <p className="mt-2.5 max-w-[460px] text-[14.5px] leading-relaxed text-muted-foreground">
              Chats you&apos;ve imported and the people collaborating on them.
            </p>
          </div>

          <Card className="min-w-[108px] px-4 py-3">
            <strong className="block text-[22px] font-semibold tracking-tight">
              {rooms.length}
            </strong>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Rooms
            </span>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-[42px] min-w-[240px] items-center gap-2 rounded-full border border-border bg-card px-3.5">
            <Search
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <Input
              type="search"
              placeholder="Search rooms…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-auto border-0 bg-transparent p-0 text-[13.5px] shadow-none focus-visible:ring-0"
            />
          </div>

          <ToggleGroup
            type="single"
            layoutId="rooms-filter-pill"
            value={filter}
            onValueChange={(value) => value && setFilter(value as Filter)}
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="chatgpt">ChatGPT</ToggleGroupItem>
            <ToggleGroupItem value="claude">Claude</ToggleGroupItem>
            <ToggleGroupItem value="codex">Codex</ToggleGroupItem>
          </ToggleGroup>

          <div className="flex-1" />

          <Button
            type="button"
            aria-expanded={importOpen}
            onClick={() => setImportOpen((value) => !value)}
            className="h-11 rounded-full px-5 shadow-lg shadow-primary/25"
          >
            <Plus aria-hidden="true" className="size-4" />
            Import a chat
          </Button>
        </div>

        <RoomImportPanel open={importOpen} />

        {visibleRooms.length ? (
          <div className="grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
            {visibleRooms.map((room, index) => {
              const provider = providerStyle(room.sourceProvider);
              return (
                <motion.div
                  key={room.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: index * 0.035 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Link href={`/rooms/${room.id}`} className="block h-full">
                    <Card className="flex h-full flex-col gap-3.5 p-5 transition-colors hover:border-input hover:bg-secondary">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className={provider.className}>
                          <span
                            className={`size-1.5 rounded-full ${provider.dot}`}
                          />
                          {provider.label}
                        </Badge>
                      </div>

                      <div>
                        <h3 className="m-0 text-[16px] leading-tight font-semibold tracking-tight">
                          {room.title}
                        </h3>
                        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                          {room.messageCount}{" "}
                          {room.messageCount === 1 ? "message" : "messages"}
                        </p>
                      </div>

                      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
                        <Avatar className="size-6">
                          <AvatarFallback>
                            {initials(room.title)}
                          </AvatarFallback>
                        </Avatar>
                        <ArrowUpRight
                          aria-hidden="true"
                          className="size-4 text-muted-foreground"
                        />
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              );
            })}

            <button
              type="button"
              onClick={() => setImportOpen(true)}
              style={{ color: "var(--color-muted-foreground)" }}
              className="flex min-h-[148px] flex-col items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-input bg-transparent text-[13px] font-semibold transition-colors hover:border-primary hover:bg-primary/5"
            >
              <Plus aria-hidden="true" className="size-5" />
              Import another chat
            </button>
          </div>
        ) : !importOpen ? (
          <Card className="grid justify-items-center gap-3 border-dashed px-6 py-14 text-center">
            <MessageSquareText
              aria-hidden="true"
              className="size-7 text-primary"
            />
            <h2 className="m-0 text-[18px] font-semibold">
              {rooms.length ? "No rooms match" : "No rooms yet"}
            </h2>
            <p className="m-0 text-[13px] text-muted-foreground">
              {rooms.length
                ? "Try a different search or filter."
                : "Import a shared AI chat to create your first room."}
            </p>
            {rooms.length ? null : (
              <Button
                type="button"
                onClick={() => setImportOpen(true)}
                className="rounded-full"
              >
                Import a chat
              </Button>
            )}
          </Card>
        ) : null}
      </div>
    </main>
  );
}
