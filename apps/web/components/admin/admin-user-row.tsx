"use client";

import Image from "next/image";
import { MoreHorizontal, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate, formatNumber, formatRelative } from "./admin-formatters";
import type { AdminUserDirectoryItem } from "./admin-user-directory";

export function AdminUserRow({
  user,
  currentUserId,
  isPending,
  onToggleAdmin,
  onToggleSubscription,
}: {
  user: AdminUserDirectoryItem;
  currentUserId: string;
  isPending: boolean;
  onToggleAdmin: (user: AdminUserDirectoryItem) => void;
  onToggleSubscription: (user: AdminUserDirectoryItem) => void;
}) {
  const isCurrent = user.id === currentUserId;
  const isPro = user.planId === "pro";

  return (
    <tr className="transition-colors hover:bg-muted/20">
      <td className="py-2.5 pl-4 pr-3">
        <div className="flex items-center gap-2.5">
          {user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt=""
              width={26}
              height={26}
              unoptimized
              className="size-6 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
              {(user.name ?? user.login).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 truncate">
              <span className="font-semibold text-foreground truncate">
                {user.name ?? user.login}
              </span>
              {user.isAdmin ? (
                <Badge
                  variant="outline"
                  className="border-primary/40 bg-primary/10 text-primary text-[10px] px-1.5 py-0"
                >
                  admin
                </Badge>
              ) : null}
            </div>
            <span className="text-[11px] text-muted-foreground truncate">
              @{user.login}
            </span>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[180px]">
        {user.email ?? "—"}
      </td>
      <td className="px-3 py-2.5">
        <Badge
          variant={isPro ? "default" : "outline"}
          className={`text-[10px] font-medium ${
            isPro ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          {isPro ? "Individual Pro" : "Free"}
        </Badge>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          {user.hasGithub ? (
            <span className="rounded bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground">
              GH
            </span>
          ) : null}
          {user.hasGoogle ? (
            <span className="rounded bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground">
              Google
            </span>
          ) : null}
          {user.hasPassword ? (
            <span className="rounded bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground">
              PW
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
        {formatDate(user.createdAt)}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
        {formatRelative(user.lastSeenAt)}
      </td>
      <td className="px-3 py-2.5 text-right font-medium text-foreground">
        {formatNumber(user.visits)}
      </td>
      <td className="py-2.5 pl-3 pr-4 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="size-7 p-0"
              disabled={isPending}
              aria-label={`Actions for ${user.login}`}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              onClick={() => onToggleSubscription(user)}
              className="gap-2 text-xs"
            >
              <Sparkles className="size-3.5 text-primary" />
              {isPro ? "Revoke Pro Access" : "Grant Complimentary Pro"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onToggleAdmin(user)}
              disabled={isCurrent && user.isAdmin}
              className="gap-2 text-xs"
            >
              {user.isAdmin ? (
                <>
                  <ShieldAlert className="size-3.5 text-destructive" />
                  Remove Administrator
                </>
              ) : (
                <>
                  <ShieldCheck className="size-3.5 text-primary" />
                  Promote to Administrator
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
