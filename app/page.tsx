"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceCard } from "@/components/home/choice-card";
import { HubspotAccessGate, type HubspotAccessState } from "@/components/hubspot-access-gate";

const options = [
  {
    id: "manual",
    title: "Manual Entry",
    description: "Create a contact or company manually with guided form fields.",
    actionLabel: "Manual Entry",
    icon: "✍️",
  },
  {
    id: "upload",
    title: "Upload CSV",
    description: "Import contacts and companies from a single CSV file.",
    actionLabel: "Upload File",
    icon: "📁",
  },
];

export default function Home() {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [access, setAccess] = useState<HubspotAccessState>({
    accessToken: "",
    validated: false,
    scopes: [],
    missingRecommendedScopes: [],
  });

  const selectedLabel = useMemo(
    () => options.find((item) => item.id === selectedOption)?.title,
    [selectedOption],
  );

  function handleSelect(optionId: string) {
    if (!access.validated) {
      return;
    }

    setLoading(true);
    setTimeout(() => {
      setSelectedOption(optionId);
      setLoading(false);
    }, 300);
  }

  return (
    <main className="min-h-screen bg-slate-50 py-14 px-6 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-14">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white p-10 shadow-xl shadow-slate-900/5 sm:p-14">
          <div className="max-w-3xl space-y-6">
            <p className="inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
              Ready to onboard data faster?
            </p>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                How would you like to add data?
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-slate-600">
                Choose the best option for your workflow. You can enter data manually or upload a file to preview and map imported records.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="default" size="lg" type="button" disabled>
                Get started in seconds
              </Button>
              <Button variant="secondary" size="lg" type="button" disabled>
                Built for teams and imports
              </Button>
            </div>
          </div>
        </section>

        <HubspotAccessGate onAccessChange={setAccess} />

        <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-[2rem] border border-slate-200/80 bg-white p-8 shadow-sm shadow-slate-900/5">
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-500">
                  Phase 1 workflow
                </p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-950">
                  Pick how you want to add new HubSpot contacts and companies.
                </h2>
              </div>
              <p className="text-slate-600 leading-7">
                Select one of the options below to continue. Each card includes hover, selected, and active states so you can preview the next step.
              </p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {options.map((option) => (
                <ChoiceCard
                  key={option.id}
                  title={option.title}
                  description={option.description}
                  actionLabel={option.actionLabel}
                  icon={option.icon}
                  selected={selectedOption === option.id}
                  isLoading={loading && selectedOption === option.id}
                  onSelect={() => handleSelect(option.id)}
                />
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-dashed border-slate-200/80 bg-slate-950/5 p-8 text-slate-700 shadow-sm shadow-slate-900/5">
            {!selectedOption ? (
              <div className="flex h-full flex-col justify-center gap-5 text-center sm:text-left">
                <div className="space-y-3">
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Empty state
                  </p>
                  <h3 className="text-2xl font-semibold text-slate-950">
                    No data source selected yet
                  </h3>
                  <p className="max-w-xl text-slate-600">
                    Select a card to begin. Your selection will be highlighted and the next step will become available.
                  </p>
                </div>
                <div className="mx-auto w-full max-w-sm sm:mx-0">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-sm text-slate-500">Tip</p>
                    <p className="mt-3 text-base text-slate-700">
                      Manual entry is best for a few records, while upload is ideal for large lists and spreadsheets.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Selected option
                </p>
                <h3 className="text-2xl font-semibold text-slate-950">
                  {selectedLabel}
                </h3>
                <p className="text-slate-600 leading-7">
                  You can continue with this workflow and configure fields or upload settings for the selected path.
                </p>
                {!access.validated ? (
                  <Button variant="default" size="lg" type="button" disabled>
                    Validate HubSpot key first
                  </Button>
                ) : selectedOption === "manual" ? (
                  <Link href="/manual-entry" className="w-full sm:w-auto">
                    <Button variant="default" size="lg" type="button" disabled={loading}>
                      Continue
                    </Button>
                  </Link>
                ) : selectedOption === "upload" ? (
                  <Link href="/upload" className="w-full sm:w-auto">
                    <Button variant="default" size="lg" type="button" disabled={loading}>
                      Continue
                    </Button>
                  </Link>
                ) : (
                  <Button variant="default" size="lg" type="button" disabled={loading}>
                    Continue
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
