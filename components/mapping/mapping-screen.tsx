"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import type { HubSpotPropertyOption } from "@/lib/hubspotProperties";

interface ColumnMapping {
  source: string;
  target: string;
}

interface MappingScreenProps {
  propertyOptions: HubSpotPropertyOption[];
}

const defaultSourceColumns = ["Email", "First Name", "Last Name", "Company"];
const defaultMappings: ColumnMapping[] = [
  { source: "Email", target: "email" },
  { source: "First Name", target: "firstname" },
  { source: "Last Name", target: "lastname" },
  { source: "Company", target: "name" },
];
const requiredTargets = ["email", "name", "domain"];

function parseSession<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  const stored = window.sessionStorage.getItem(key);
  if (!stored) {
    return fallback;
  }

  try {
    return JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
}

export function MappingScreen({ propertyOptions }: MappingScreenProps) {
  const [sourceColumns] = useState<string[]>(() => parseSession("upload-source-columns", defaultSourceColumns));
  const [mappings, setMappings] = useState<ColumnMapping[]>(() => parseSession("upload-column-mappings", defaultMappings));
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const mappedTargets = useMemo(() => mappings.map((mapping) => mapping.target).filter(Boolean), [mappings]);
  const unmappedRequired = useMemo(
    () => requiredTargets.filter((target) => !mappedTargets.includes(target)),
    [mappedTargets],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("upload-source-columns", JSON.stringify(sourceColumns));
  }, [sourceColumns]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("upload-column-mappings", JSON.stringify(mappings));
  }, [mappings]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handleMappingChange = (source: string, target: string) => {
    setMappings((current) => current.map((mapping) => (mapping.source === source ? { ...mapping, target } : mapping)));
    setToast({ type: "success", message: `Updated mapping for ${source}.` });
  };

  const canProceed = unmappedRequired.length === 0;

  return (
    <main className="min-h-screen bg-slate-50 py-14 px-6 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white p-10 shadow-xl shadow-slate-900/5 sm:p-14">
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
              HubSpot mapping
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              Review and edit your upload column mappings.
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-slate-600">
              Match each source field to a HubSpot property and keep required fields mapped before importing.
            </p>
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Source to HubSpot mapping</CardTitle>
            <CardDescription>
              Edit source column mappings. Required targets are highlighted until mapped.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {unmappedRequired.length ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Required HubSpot targets still unmapped: {unmappedRequired.join(", ")}.
              </div>
            ) : (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                All required fields are mapped.
              </div>
            )}

            <div className="space-y-4">
              {mappings.map((mapping) => {
                const isRequiredHighlight = mapping.target === "" && unmappedRequired.length > 0;
                return (
                  <div
                    key={mapping.source}
                    className={`grid gap-4 rounded-3xl border p-5 sm:grid-cols-[1fr_1fr] ${
                      isRequiredHighlight ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-900">Source column</p>
                      <p className="text-base text-slate-700">{mapping.source}</p>
                    </div>
                    <Select
                      label="HubSpot property"
                      searchable
                      value={mapping.target}
                      onValueChange={(value) => handleMappingChange(mapping.source, value)}
                      options={propertyOptions}
                      className={isRequiredHighlight ? "ring-2 ring-amber-300" : undefined}
                    />
                  </div>
                );
              })}
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
              <p className="font-semibold text-slate-900">Session persistence</p>
              <p className="mt-2">
                Mappings are stored in browser session storage so they remain available as you work.
              </p>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-600">{mappings.length} source columns available for mapping.</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href="/upload">
                  <Button variant="secondary" size="lg" type="button">
                    Back to upload
                  </Button>
                </Link>
                <Button variant="default" size="lg" type="button" disabled={!canProceed}>
                  Continue to preview
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {toast ? <Toast type={toast.type} message={toast.message} visible /> : null}
    </main>
  );
}
