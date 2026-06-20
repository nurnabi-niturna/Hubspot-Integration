"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ChoiceCardProps {
  title: string;
  description: string;
  actionLabel: string;
  icon: string;
  selected: boolean;
  isLoading: boolean;
  onSelect: () => void;
}

export function ChoiceCard({
  title,
  description,
  actionLabel,
  icon,
  selected,
  isLoading,
  onSelect,
}: ChoiceCardProps) {
  return (
    <Card
      className={cn(
        "group cursor-pointer transition duration-300",
        "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:-translate-y-1 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg",
        selected && "border-slate-950/10 dark:border-slate-100/10 bg-slate-950/5 dark:bg-white/5 shadow-lg",
      )}
      onClick={onSelect}
    >
      <CardHeader>
        <div
          className={cn(
            "inline-flex h-14 w-14 items-center justify-center rounded-3xl text-2xl transition",
            selected
              ? "bg-slate-950 dark:bg-slate-100 text-white dark:text-slate-950"
              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
          )}
        >
          {icon}
        </div>
        <CardTitle className="text-slate-950 dark:text-slate-100">{title}</CardTitle>
        <CardDescription className="text-slate-600 dark:text-slate-400">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div className="rounded-full border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            {selected ? "Selected" : "Recommended"}
          </div>
          <Button
            type="button"
            variant={selected ? "secondary" : "default"}
            size="sm"
            isLoading={isLoading}
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
          >
            {actionLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
