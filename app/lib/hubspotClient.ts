import { createHubspotClient } from "@/app/lib/hubspot";
import { filterWritableProperties } from "@/lib/hubspotProperties.server";

export type HubSpotProperties = Record<string, string | number | boolean | null>;

export interface UpsertResult {
  id: string;
  action: "created" | "updated";
  properties: HubSpotProperties;
}

function formatHubspotError(error: unknown) {
  const err = error as {
    response?: { status?: number; data?: { message?: string; status?: string; category?: string; errors?: Array<{ code?: string; message?: string }> } };
    message?: string;
  };
  const message = err.response?.data?.message ?? err.response?.data?.errors?.[0]?.message ?? err.message ?? "";
  const code = `${err.response?.data?.category ?? ""} ${message}`.toUpperCase();

  if (err.response?.status === 401) {
    return "The private app access token is invalid or expired.";
  }

  if (err.response?.status === 403) {
    return "The private app access token is missing the required HubSpot scopes.";
  }

  if (code.includes("INVALID_OPTION")) {
    return "Selected value is not allowed.";
  }

  if (code.includes("INVALID_INTEGER")) {
    return "Invalid owner selected.";
  }

  if (message.toLowerCase().includes("email")) {
    return "Email is required or invalid.";
  }

  return "HubSpot could not process this request. Please check the mapped values and try again.";
}

async function searchObjectByProperty(
  objectType: "contacts" | "companies",
  propertyName: string,
  value: string,
  accessToken?: string,
) {
  const hubspot = createHubspotClient(accessToken);
  const response = await hubspot.post(`/crm/v3/objects/${objectType}/search`, {
    filterGroups: [
      {
        filters: [
          {
            propertyName,
            operator: "EQ",
            value,
          },
        ],
      },
    ],
    properties: [propertyName],
    limit: 1,
  });

  return response.data?.results?.[0] ?? null;
}

export async function getContactByEmail(email: string) {
  if (!email) {
    return null;
  }

  return searchObjectByProperty("contacts", "email", email);
}

export async function getCompanyByDomainOrName(domain?: string, name?: string, accessToken?: string) {
  if (domain) {
    const existingCompany = await searchObjectByProperty("companies", "domain", domain, accessToken);
    if (existingCompany) {
      return existingCompany;
    }
  }

  if (name) {
    return searchObjectByProperty("companies", "name", name, accessToken);
  }

  return null;
}

async function createObject(objectType: "contacts" | "companies", properties: HubSpotProperties, accessToken?: string) {
  const hubspot = createHubspotClient(accessToken);
  const response = await hubspot.post(`/crm/v3/objects/${objectType}`, {
    properties,
  });
  return response.data;
}

async function updateObject(objectType: "contacts" | "companies", objectId: string, properties: HubSpotProperties, accessToken?: string) {
  const hubspot = createHubspotClient(accessToken);
  const response = await hubspot.patch(`/crm/v3/objects/${objectType}/${objectId}`, {
    properties,
  });
  return response.data;
}

export async function upsertContact(properties: HubSpotProperties, accessToken?: string): Promise<UpsertResult> {
  const filteredProperties = filterWritableProperties(properties, "contact");
  const email = String(filteredProperties.email ?? "").trim();
  if (!email) {
    throw new Error("Contact email is required for upsert.");
  }

  const existingContact = await searchObjectByProperty("contacts", "email", email, accessToken);

  if (existingContact?.id) {
    const updated = await updateObject("contacts", existingContact.id, filteredProperties, accessToken);
    return { id: existingContact.id, action: "updated", properties: updated.properties ?? filteredProperties };
  }

  const created = await createObject("contacts", filteredProperties, accessToken);
  return { id: created.id, action: "created", properties: created.properties ?? filteredProperties };
}

export async function upsertCompany(properties: HubSpotProperties, accessToken?: string): Promise<UpsertResult> {
  const filteredProperties = filterWritableProperties(properties, "company");
  const domain = String(filteredProperties.domain ?? "").trim();
  const name = String(filteredProperties.name ?? "").trim();

  if (!domain && !name) {
    throw new Error("Company name or domain is required for upsert.");
  }

  const existingCompany = await getCompanyByDomainOrName(domain || undefined, name || undefined, accessToken);

  if (existingCompany?.id) {
    const updated = await updateObject("companies", existingCompany.id, filteredProperties, accessToken);
    return { id: existingCompany.id, action: "updated", properties: updated.properties ?? filteredProperties };
  }

  const created = await createObject("companies", filteredProperties, accessToken);
  return { id: created.id, action: "created", properties: created.properties ?? filteredProperties };
}

export async function associateContactAndCompany(contactId: string, companyId: string, accessToken?: string) {
  try {
    const hubspot = createHubspotClient(accessToken);
    const response = await hubspot.put(
      `/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`,
      {},
    );
    return response.data;
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: { message?: string } } };
    if (err.response?.status === 409) {
      return {
        message: "Contact and company are already associated.",
      };
    }
    throw new Error(formatHubspotError(error));
  }
}

export async function friendlyHubspotApiCall<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error: unknown) {
    throw new Error(formatHubspotError(error));
  }
}
