import { NextResponse } from "next/server";
import {
  friendlyHubspotApiCall,
  upsertCompany,
  upsertContact,
  associateContactAndCompany,
  HubSpotProperties,
} from "@/app/lib/hubspotClient";

interface HubSpotPayload {
  contact: HubSpotProperties;
  company?: HubSpotProperties;
  associate?: boolean;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as HubSpotPayload;

    if (!body.contact?.email) {
      return NextResponse.json(
        { success: false, message: "Contact email is required." },
        { status: 400 },
      );
    }

    const contactResult = await friendlyHubspotApiCall(() => upsertContact(body.contact));
    let companyResult: Awaited<ReturnType<typeof upsertCompany>> | null = null;
    let associationResult: unknown = null;

    if (body.company && (String(body.company.domain ?? "").trim() || String(body.company.name ?? "").trim())) {
      const companyPayload = body.company as HubSpotProperties;
      companyResult = await friendlyHubspotApiCall(() => upsertCompany(companyPayload));

      const companyId = companyResult?.id;

      if (body.associate && companyId) {
        associationResult = await friendlyHubspotApiCall(() =>
          associateContactAndCompany(contactResult.id, companyId),
        );
      }
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