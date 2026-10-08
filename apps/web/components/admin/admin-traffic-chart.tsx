"use client";

import { useMemo, useState } from "react";
import { TrendingUp, Users, Eye } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "./admin-formatters";

type TrafficPoint = {
  day: string;
  views: number;
  visitors: number;
};

export function AdminTrafficChart({ daily }: { daily: TrafficPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const stats = useMemo(() => {
    if (daily.length === 0) {
      return { totalViews: 0, totalVisitors: 0, peak: null, maxViews: 1 };
    }
    const totalViews = daily.reduce((sum, d) => sum + d.views, 0);
    const totalVisitors = daily.reduce((sum, d) => sum + d.visitors, 0);
    const peak = daily.reduce(
      (max, d) => (d.views > max.views ? d : max),
      daily[0]!,
    );
    const maxViews = Math.max(1, ...daily.map((d) => d.views));
    return { totalViews, totalVisitors, peak, maxViews };
  }, [daily]);

  const activePoint = hoveredIndex !== null ? daily[hoveredIndex] : stats.peak;

  return (
    <Card className="overflow-hidden border-border/80 bg-card/60 backdrop-blur-xs">
      <CardHeader className="flex flex-col gap-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <TrendingUp className="size-4 text-primary" />
            Traffic & Usage Trends
          </CardTitle>
          <CardDescription>
            Daily page views and unique visitors over the last 30 days
          </CardDescription>
        </div>
        {activePoint ? (
          <div className="flex items-center gap-2 text-xs">
            <Badge
              variant="outline"
              className="gap-1 border-primary/30 bg-primary/10 text-primary"
            >
              <span className="font-semibold">{activePoint.day}:</span>
              <span>{formatNumber(activePoint.views)} views</span>
              <span className="text-muted-foreground">·</span>
              <span>{formatNumber(activePoint.visitors)} visitors</span>
            </Badge>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {daily.length === 0 ? (
          <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-border/60 text-sm text-muted-foreground">
            No page views recorded yet in the last 30 days.
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className="flex h-36 items-end gap-1 sm:gap-1.5 rounded-lg border border-border/40 bg-muted/20 p-3 pt-6"
              role="img"
              aria-label="Daily page views bar chart"
            >
              {daily.map((point, index) => {
                const heightPercent = Math.max(
                  6,
                  Math.round((point.views / stats.maxViews) * 100),
                );
                const isHovered = hoveredIndex === index;
                const isPeak = stats.peak?.day === point.day;

                return (
                  <div
                    key={point.day}
                    tabIndex={0}
                    role="button"
                    aria-label={`${point.day}: ${point.views} views, ${point.visitors} visitors`}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onFocus={() => setHoveredIndex(index)}
                    onBlur={() => setHoveredIndex(null)}
                    className="group relative flex h-full flex-1 flex-col justify-end items-center cursor-pointer outline-none"
                  >
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full rounded-t transition-all duration-150 ${
                        isHovered
                          ? "bg-primary shadow-sm"
                          : isPeak
                            ? "bg-primary/80"
                            : point.views === 0
                              ? "bg-muted/40"
                              : "bg-primary/50 hover:bg-primary/70"
                      }`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <span>{daily[0]?.day}</span>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Eye className="size-3 text-primary" />{" "}
                  {formatNumber(stats.totalViews)} total views
                </span>
                <span className="flex items-center gap-1">
                  <Users className="size-3 text-muted-foreground" />{" "}
                  {formatNumber(stats.totalVisitors)} total visits
                </span>
              </div>
              <span>{daily[daily.length - 1]?.day}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
