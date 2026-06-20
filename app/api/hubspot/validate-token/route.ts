import { NextResponse } from "next/server";
import { createHubspotClient } from "@/app/lib/hubspot";

const REQUIRED_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
];

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getStatus(error: unknown) {
  return (error as { response?: { status?: number } }).response?.status;
}

function missingScopeMessage(missingRequiredScopes: string[]) {
  if (!missingRequiredScopes.length) {
    return "";
  }

  return `This token is valid but missing required permissions: ${missingRequiredScopes.join(", ")}.`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { accessToken?: string };
    const accessToken = body.accessToken?.trim();

    if (!accessToken) {
      return NextResponse.json(
        { success: false, message: "Enter your HubSpot private app access token." },
        { status: 400 },
      );
    }

    const hubspot = createHubspotClient(accessToken);

    let scopes: string[] = [];

    try {
      const tokenInfo = await hubspot.get(`/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`);
      scopes = unique((tokenInfo.data?.scopes ?? tokenInfo.data?.scope ?? []) as string[]);
      const missingRequiredScopes = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));

      if (missingRequiredScopes.length) {
        return NextResponse.json(
          {
            success: false,
            message: missingScopeMessage(missingRequiredScopes),
            scopes,
            missingRequiredScopes,
            missingRecommendedScopes: [],
          },
          { status: 403 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "Token validated with the required HubSpot permissions.",
        scopes,
        missingRequiredScopes,
        missingRecommendedScopes: [],
        hubId: tokenInfo.data?.hub_id ?? tokenInfo.data?.hubId,
        user: tokenInfo.data?.user,
      });
    } catch (scopeError: unknown) {
      if (getStatus(scopeError) === 401) {
        return NextResponse.json(
          { success: false, message: "The private app access token is invalid or expired." },
          { status: 401 },
        );
      }
    }

    const permissionChecks = await Promise.allSettled([
      hubspot.get("/crm/v3/properties/contacts", { params: { archived: false } }),
      hubspot.get("/crm/v3/properties/companies", { params: { archived: false } }),
      hubspot.post("/crm/v3/objects/contacts/search", { limit: 1, properties: ["email"] }),
      hubspot.post("/crm/v3/objects/companies/search", { limit: 1, properties: ["name", "domain"] }),
    ]);

    const missingRequiredScopes = [
      permissionChecks[0].status === "rejected" || permissionChecks[2].status === "rejected"
        ? "crm.objects.contacts.read"
        : "",
      permissionChecks[1].status === "rejected" || permissionChecks[3].status === "rejected"
        ? "crm.objects.companies.read"
        : "",
    ].filter(Boolean);

    const authFailure = permissionChecks.find(
      (check) => check.status === "rejected" && getStatus(check.reason) === 401,
    );
    if (authFailure) {
      return NextResponse.json(
        { success: false, message: "The private app access token is invalid or expired." },
        { status: 401 },
      );
    }

    if (missingRequiredScopes.length) {
      return NextResponse.json(
        {
          success: false,
          message: missingScopeMessage(missingRequiredScopes),
          scopes,
          missingRequiredScopes,
          missingRecommendedScopes: [],
        },
        { status: 403 },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Token validated for HubSpot contact and company access. Write permissions will also be checked by HubSpot during save/import.",
      scopes,
      missingRequiredScopes: [],
      missingRecommendedScopes: [],
    });
  } catch (error: unknown) {
    const err = error as { response?: { status?: number } };
    return NextResponse.json(
      {
        success: false,
        message:
          err.response?.status === 401
            ? "The private app access token is invalid or expired."
            : "Unable to validate this HubSpot token. Please check the key and try again.",
      },
      { status: err.response?.status === 401 ? 401 : 500 },
    );
  }
}
