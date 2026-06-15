import { NextResponse } from "next/server";
import {
  friendlyHubspotApiCall,
  upsertCompany,
  upsertContact,
  associateContactAndCompany,
  HubSpotProperties,
} from "@/app/lib/hubspotClient";
import { filterWritableProperties } from "@/lib/hubspotProperties.server";

interface HubSpotPayload {
  contact?: HubSpotProperties;
  company?: HubSpotProperties;
  associate?: boolean;
  saveMode?: "contact" | "company" | "both";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as HubSpotPayload;
    const saveMode = body.saveMode ?? "both";

    if (saveMode === "contact" || saveMode === "both") {
      if (!body.contact?.email) {
        return NextResponse.json(
          { success: false, message: "Contact email is required." },
          { status: 400 },
        );
      }
    }

    if (saveMode === "company" || saveMode === "both") {
      const hasCompanyIdentifier = String(body.company?.domain ?? "").trim() || String(body.company?.name ?? "").trim();
      if (!hasCompanyIdentifier) {
        return NextResponse.json(
          { success: false, message: "Company name or domain is required." },
          { status: 400 },
        );
      }
    }

    const contactPayload = saveMode !== "company" ? filterWritableProperties(body.contact, "contact") : undefined;
    const companyPayload = saveMode !== "contact" ? filterWritableProperties(body.company, "company") : undefined;

    let contactResult: Awaited<ReturnType<typeof upsertContact>> | null = null;
    let companyResult: Awaited<ReturnType<typeof upsertCompany>> | null = null;
    let associationResult: unknown = null;

    if (saveMode !== "company" && contactPayload && Object.keys(contactPayload).length) {
      contactResult = await friendlyHubspotApiCall(() => upsertContact(contactPayload));
    }

    if (saveMode !== "contact" && companyPayload && Object.keys(companyPayload).length) {
      companyResult = await friendlyHubspotApiCall(() => upsertCompany(companyPayload));
    }

    if (saveMode === "both" && body.associate && contactResult?.id && companyResult?.id) {
      associationResult = await friendlyHubspotApiCall(() =>
        associateContactAndCompany(contactResult.id, companyResult.id),
      );
    }

    return NextResponse.json({
      success: true,
      message: "HubSpot objects processed successfully.",
      contact: contactResult,
      company: companyResult,
      association: associationResult,
    });
  } catch (error: unknown) {
    const err = error as { message?: string };

    return NextResponse.json(
      {
        success: false,
        message: err.message || "HubSpot Error",
      },
      { status: 500 },
    );
  }
}