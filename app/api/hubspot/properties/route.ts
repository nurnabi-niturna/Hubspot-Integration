import { NextResponse } from "next/server";
import { createHubspotClient } from "@/app/lib/hubspot";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const accessToken = body.accessToken?.trim() || process.env.HUBSPOT_ACCESS_TOKEN;
    const objectType = body.objectType; // "contacts" or "companies"

    if (!accessToken) {
      return NextResponse.json(
        { success: false, message: "HubSpot access token is missing." },
        { status: 400 }
      );
    }

    if (objectType !== "contacts" && objectType !== "companies") {
      return NextResponse.json(
        { success: false, message: "Invalid object type." },
        { status: 400 }
      );
    }

    const hubspot = createHubspotClient(accessToken);
    const response = await hubspot.get(`/crm/v3/properties/${objectType}`, {
      params: { archived: false },
    });

    const properties = response.data.results.map((prop: any) => ({
      name: prop.name,
      label: prop.label || prop.name,
      type: prop.type,
      description: prop.description || "",
      options: prop.options || [],
      readonly: prop.readOnlyValue || prop.calculated || false,
    }));

    return NextResponse.json({ success: true, properties });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch properties" },
      { status: 500 }
    );
  }
}
