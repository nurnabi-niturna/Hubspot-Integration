import { NextResponse } from "next/server";
import { createHubspotClient } from "@/app/lib/hubspot";

const REQUIRED_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
];

const RECOMMENDED_SCOPES = ["crm.objects.deals.read", "crm.objects.deals.write"];

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
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
    const tokenInfo = await hubspot.get(`/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`);
    const scopes = unique((tokenInfo.data?.scopes ?? tokenInfo.data?.scope ?? []) as string[]);
    const missingRequiredScopes = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
    const missingRecommendedScopes = RECOMMENDED_SCOPES.filter((scope) => !scopes.includes(scope));

    if (missingRequiredScopes.length) {
      return NextResponse.json(
        {
          success: false,
          message: "This token is valid but missing required contact or company permissions.",
          scopes,
          missingRequiredScopes,
          missingRecommendedScopes,
        },
        { status: 403 },
      );
    }

    return NextResponse.json({
      success: true,
      message: missingRecommendedScopes.length
        ? "Token validated. Contact and company permissions are ready. Deal scopes are missing."
        : "Token validated with the required HubSpot permissions.",
      scopes,
      missingRequiredScopes,
      missingRecommendedScopes,
      hubId: tokenInfo.data?.hub_id ?? tokenInfo.data?.hubId,
      user: tokenInfo.data?.user,
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
