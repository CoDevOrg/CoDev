"use client";

import { useEffect, useRef, type ReactElement } from "react";
import {
  BookOpen,
  Bot,
  FileDiff,
  FileSearch,
  FileText,
  Folder,
  GitBranch,
  GitBranchPlus,
  Globe,
  Import,
  LayoutGrid,
  ListChecks,
  MessageCircleQuestion,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Settings,
  SquareTerminal,
  Target,
  TextCursorInput,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { ProviderLogo } from "./provider-logos";
import type {
  ComposerMenuIcon,
  ComposerMenuItem,
} from "./use-composer-typeahead";

const ICONS: Record<Exclude<ComposerMenuIcon, "provider">, LucideIcon> = {
  plan: ListChecks,
  ask: MessageCircleQuestion,
  goal: Target,
  review: FileSearch,
  init: BookOpen,
  file: FileText,
  dir: Folder,
  chat: MessageSquare,
  agent: Bot,
  selection: TextCursorInput,
  terminal: SquareTerminal,
  changes: FileDiff,
  branch: GitBranch,
  create: GitBranchPlus,
  share: UserPlus,
  new: MessageSquarePlus,
  rename: Pencil,
  board: LayoutGrid,
  settings: Settings,
  import: Import,
  preview: Globe,
};

/** The DOM id of an option, for the textarea's aria-activedescendant. */
export function composerOptionId(listboxId: string, index: number) {
  return `${listboxId}-option-${index}`;
}

function ItemIcon({ item }: { item: ComposerMenuItem }) {
  if (item.provider) return <ProviderLogo provider={item.provider} size={14} />;
  const Icon = ICONS[item.icon === "provider" ? "agent" : item.icon];
  return <Icon aria-hidden="true" />;
}

function MenuOption({
  item,
  id,
  index,
  active,
  onSelect,
  onActiveChange,
}: {
  item: ComposerMenuItem;
  id: string;
  index: number;
  active: boolean;
  onSelect: (item: ComposerMenuItem) => void;
  onActiveChange: (index: number) => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={item.disabled || undefined}
      data-index={index}
      className="gen2-composer-menu-option"
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => active || onActiveChange(index)}
      onClick={() => item.disabled || onSelect(item)}
    >
      <ItemIcon item={item} />
      <span className="gen2-composer-menu-label">{item.label}</span>
      {item.detail ? (
        <span className="gen2-composer-menu-detail">{item.detail}</span>
      ) : null}
    </div>
  );
}

function groupItems(items: ComposerMenuItem[]) {
  const groups: Array<{
    name: string;
    entries: Array<[ComposerMenuItem, number]>;
  }> = [];
  items.forEach((item, index) => {
    const last = groups.at(-1);
    if (last?.name === item.group) last.entries.push([item, index]);
    else groups.push({ name: item.group, entries: [[item, index]] });
  });
  return groups;
}

type MenuProps = {
  open: boolean;
  side: "top" | "bottom";
  label: string;
  listboxId: string;
  items: ComposerMenuItem[];
  activeIndex: number;
  onSelect: (item: ComposerMenuItem) => void;
  onActiveChange: (index: number) => void;
  onDismiss: () => void;
  /** The composer form the menu spans and anchors to. */
  children: ReactElement;
};

function MenuList({
  listboxId,
  label,
  items,
  activeIndex,
  onSelect,
  onActiveChange,
}: Omit<MenuProps, "open" | "side" | "onDismiss" | "children">) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the active option visible without scrolling anything outside it.
  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    if (!list || !option) return;
    const bottom = option.offsetTop + option.offsetHeight;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
  }, [activeIndex]);

  return (
    <div
      ref={listRef}
      id={listboxId}
      role="listbox"
      aria-label={label}
      className="gen2-composer-menu-list"
    >
      {groupItems(items).map((group, groupIndex) => (
        <div
          key={group.name}
          role="group"
          aria-labelledby={`${listboxId}-group-${groupIndex}`}
        >
          <div
            id={`${listboxId}-group-${groupIndex}`}
            className="gen2-composer-menu-group"
            role="presentation"
          >
            {group.name}
          </div>
          {group.entries.map(([item, index]) => (
            <MenuOption
              key={item.id}
              item={item}
              id={composerOptionId(listboxId, index)}
              index={index}
              active={index === activeIndex}
              onSelect={onSelect}
              onActiveChange={onActiveChange}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The `/` and `@` menu: a listbox in a popover as wide as the composer. The
 * textarea keeps focus and drives it through aria-activedescendant; clicks
 * on the composer itself never dismiss it.
 */
export function ChatTypeaheadMenu({
  open,
  side,
  onDismiss,
  children,
  ...list
}: MenuProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  return (
    <Popover open={open} onOpenChange={(next) => !next && onDismiss()}>
      <PopoverAnchor asChild ref={anchorRef}>
        {children}
      </PopoverAnchor>
      <PopoverContent
        side={side}
        align="start"
        sideOffset={8}
        className="gen2-workspace-surface gen2-composer-menu"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node))
            event.preventDefault();
        }}
      >
        <MenuList {...list} />
      </PopoverContent>
    </Popover>
  );
}
