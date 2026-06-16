"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface HubspotAccessState {
  accessToken: string;
  validated: boolean;
  scopes: string[];
  missingRecommendedScopes: string[];
}

interface HubspotAccessGateProps {
  onAccessChange?: (state: HubspotAccessState) => void;
  compact?: boolean;
}

const STORAGE_KEY = "hubspot_private_app_access";

function readStoredAccess(): HubspotAccessState {
  if (typeof window === "undefined") {
    return { accessToken: "", validated: false, scopes: [], missingRecommendedScopes: [] };
  }

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "{}") as Partial<HubspotAccessState>;
    return {
      accessToken: parsed.accessToken || "",
      validated: Boolean(parsed.validated && parsed.accessToken),
      scopes: parsed.scopes || [],
      missingRecommendedScopes: parsed.missingRecommendedScopes || [],
    };
  } catch {
    return { accessToken: "", validated: false, scopes: [], missingRecommendedScopes: [] };
  }
}

export function HubspotAccessGate({ onAccessChange, compact }: HubspotAccessGateProps) {
  const [access, setAccess] = useState<HubspotAccessState>(() => readStoredAccess());
  const [draftToken, setDraftToken] = useState(access.accessToken);
  const [isChecking, setIsChecking] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    access.validated ? { type: "success", text: "HubSpot access is validated for this browser session." } : null,
  );

  useEffect(() => {
    onAccessChange?.(access);
  }, [access, onAccessChange]);

  function saveAccess(next: HubspotAccessState) {
    setAccess(next);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  }

  async function validateToken() {
    const token = draftToken.trim();
    if (!token) {
      setMessage({ type: "error", text: "Enter your private app access token first." });
      saveAccess({ accessToken: "", validated: false, scopes: [], missingRecommendedScopes: [] });
      return;
    }

    setIsChecking(true);
    setMessage(null);

    try {
      const response = await fetch("/api/hubspot/validate-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to validate token.");
      }

      const next = {
        accessToken: token,
        validated: true,
        scopes: result.scopes || [],
        missingRecommendedScopes: result.missingRecommendedScopes || [],
      };
      saveAccess(next);
      setMessage({ type: "success", text: result.message || "Token validated successfully." });
    } catch (error: unknown) {
      const err = error as { message?: string };
      saveAccess({ accessToken: token, validated: false, scopes: [], missingRecommendedScopes: [] });
      setMessage({ type: "error", text: err.message || "Unable to validate token." });
    } finally {
      setIsChecking(false);
    }
  }

  function clearToken() {
    setDraftToken("");
    saveAccess({ accessToken: "", validated: false, scopes: [], missingRecommendedScopes: [] });
    setMessage(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  return (
    <Card className={compact ? "shadow-sm" : ""}>
      <CardHeader>
        <CardTitle>Connect HubSpot private app</CardTitle>
        <CardDescription>
          Enter a private app access token with contacts and companies read/write scopes before manual entry or CSV import.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
          <Input
            type="password"
            value={draftToken}
            onChange={(event) => {
              setDraftToken(event.target.value);
              if (access.validated) {
                saveAccess({ accessToken: event.target.value, validated: false, scopes: [], missingRecommendedScopes: [] });
              }
            }}
            placeholder="pat-na1-..."
            autoComplete="off"
          />
          <Button type="button" isLoading={isChecking} onClick={validateToken}>
            {isChecking ? "Checking..." : "Check key"}
          </Button>
          <Button type="button" variant="outline" onClick={clearToken}>
            Clear
          </Button>
        </div>

        {message ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              message.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        {access.validated && access.missingRecommendedScopes.length ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Deal scopes are missing: {access.missingRecommendedScopes.join(", ")}. Contacts and companies can still be imported.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
