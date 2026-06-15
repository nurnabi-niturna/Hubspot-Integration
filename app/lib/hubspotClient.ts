import { hubspot } from "@/app/lib/hubspot";

export type HubSpotProperties = Record<string, string | number | boolean | null>;

export interface UpsertResult {
  id: string;
  action: "created" | "updated";
  properties: HubSpotProperties;
}

function formatHubspotError(error: unknown) {
  const err = error as { response?: { data?: { message?: string; status?: string; category?: string } }; message?: string };
  const message = err.response?.data?.message ?? err.message ?? "Unknown HubSpot error";
  return `HubSpot API error: ${message}`;
}

async function searchObjectByProperty(
  objectType: "contacts" | "companies",
  propertyName: string,
  value: string,
) {
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

export async function getCompanyByDomainOrName(domain?: string, name?: string) {
  if (domain) {
    const existingCompany = await searchObjectByProperty("companies", "domain", domain);
    if (existingCompany) {
      return existingCompany;
    }
  }

  if (name) {
    return searchObjectByProperty("companies", "name", name);
  }

  return null;
}

async function createObject(objectType: "contacts" | "companies", properties: HubSpotProperties) {
  const response = await hubspot.post(`/crm/v3/objects/${objectType}`, {
    properties,
  });
  return response.data;
}

async function updateObject(objectType: "contacts" | "companies", objectId: string, properties: HubSpotProperties) {
  const response = await hubspot.patch(`/crm/v3/objects/${objectType}/${objectId}`, {
    properties,
  });
  return response.data;
}

export async function upsertContact(properties: HubSpotProperties): Promise<UpsertResult> {
  const email = String(properties.email ?? "").trim();
  if (!email) {
    throw new Error("Contact email is required for upsert.");
  }

  const existingContact = await getContactByEmail(email);

  if (existingContact?.id) {
    const updated = await updateObject("contacts", existingContact.id, properties);
    return { id: existingContact.id, action: "updated", properties: updated.properties ?? properties };
  }

  const created = await createObject("contacts", properties);
  return { id: created.id, action: "created", properties: created.properties ?? properties };
}

export async function upsertCompany(properties: HubSpotProperties): Promise<UpsertResult> {
  const domain = String(properties.domain ?? "").trim();
  const name = String(properties.name ?? "").trim();

  if (!domain && !name) {
    throw new Error("Company name or domain is required for upsert.");
  }

  const existingCompany = await getCompanyByDomainOrName(domain || undefined, name || undefined);

  if (existingCompany?.id) {
    const updated = await updateObject("companies", existingCompany.id, properties);
    return { id: existingCompany.id, action: "updated", properties: updated.properties ?? properties };
  }

  const created = await createObject("companies", properties);
  return { id: created.id, action: "created", properties: created.properties ?? properties };
}

export async function associateContactAndCompany(contactId: string, companyId: string) {
  try {
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
