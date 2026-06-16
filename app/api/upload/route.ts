import type { NextRequest } from "next/server";
import { filterWritableProperties } from "@/lib/hubspotProperties.server";
import { friendlyHubspotApiCall, upsertContact, upsertCompany, associateContactAndCompany } from "@/app/lib/hubspotClient";

interface BatchUploadPayload {
  accessToken?: string;
  rows: Array<{
    contact?: Record<string, string | number | null>;
    company?: Record<string, string | number | null>;
  }>;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body: BatchUploadPayload = await req.json();
    const accessToken = body.accessToken?.trim();

    if (!accessToken && !process.env.HUBSPOT_ACCESS_TOKEN) {
      return Response.json(
        { success: false, message: "Enter and validate a HubSpot private app access token first." },
        { status: 400 }
      );
    }

    if (!body.rows || !Array.isArray(body.rows)) {
      return Response.json(
        { success: false, message: "Invalid payload: rows array is required" },
        { status: 400 }
      );
    }

    if (body.rows.length === 0) {
      return Response.json(
        { success: false, message: "No rows to process" },
        { status: 400 }
      );
    }

    const results = [];
    const errorRows = [];
    let successCount = 0;
    let errorCount = 0;

    for (let rowIndex = 0; rowIndex < body.rows.length; rowIndex++) {
      const row = body.rows[rowIndex];
      let contactId: string | undefined;
      let companyId: string | undefined;

      try {
        // Process contact if present
        if (row.contact && Object.keys(row.contact).length > 0) {
          const contactPayload = filterWritableProperties(row.contact, "contact");
          
          // Check if email is present
          if (!contactPayload.email) {
            throw new Error("Contact row requires email address");
          }

          const contactResult = await friendlyHubspotApiCall(() => upsertContact(contactPayload, accessToken));
          contactId = contactResult.id;
        }

        // Process company if present
        if (row.company && Object.keys(row.company).length > 0) {
          const companyPayload = filterWritableProperties(row.company, "company");
          
          // Check if name or domain is present
          if (!companyPayload.name && !companyPayload.domain) {
            throw new Error("Company row requires name or domain");
          }

          const companyResult = await friendlyHubspotApiCall(() => upsertCompany(companyPayload, accessToken));
          companyId = companyResult.id;
        }

        // Associate contact to company if both exist
        if (contactId && companyId) {
          const currentContactId = contactId;
          const currentCompanyId = companyId;
          await friendlyHubspotApiCall(() => associateContactAndCompany(currentContactId, currentCompanyId, accessToken));
        }

        results.push({
          rowIndex,
          success: true,
          message: `Successfully created ${contactId ? "contact" : ""}${contactId && companyId ? " and " : ""}${companyId ? "company" : ""}`,
          contactId,
          companyId,
        });

        successCount++;
      } catch (error: unknown) {
        const err = error as { message?: string };
        errorCount++;
        errorRows.push({
          rowIndex,
          message: err.message || "Failed to process row",
          row,
        });
        results.push({
          rowIndex,
          success: false,
          message: err.message || "Failed to process row",
        });
      }
    }

    return Response.json({
      success: errorCount === 0,
      totalProcessed: body.rows.length,
      successCount,
      failureCount: errorCount,
      errorRows,
      message: `Processed ${body.rows.length} rows: ${successCount} succeeded, ${errorCount} failed`,
      results,
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    return Response.json(
      {
        success: false,
        message: err.message || "Failed to process upload",
      },
      { status: 500 }
    );
  }
}
