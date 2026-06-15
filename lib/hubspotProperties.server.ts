import fs from "fs";
import path from "path";
import type { HubSpotPropertyDefinition, HubSpotPropertyOption } from "@/lib/hubspotProperties";
import type { HubSpotProperties } from "@/app/lib/hubspotClient";

const propertyFilePath = path.join(process.cwd(), "HUBSPOT.md");

function parseEnumOptions(accepted: string): HubSpotPropertyOption[] {
  const options: HubSpotPropertyOption[] = [];
  const regex = /([^;=]+?)=`([^`]+)`/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(accepted))) {
    const label = match[1].trim();
    const value = match[2].trim();
    if (label && value) {
      options.push({ label, value });
    }
  }

  return options;
}

function determineFormat(name: string, type: string, label: string) {
  const normalizedName = name.toLowerCase();
  const normalizedLabel = label.toLowerCase();

  if (normalizedName === "email" || normalizedLabel.includes("email")) {
    return "email";
  }

  if (
    normalizedName === "website" ||
    normalizedName === "hs_linkedin_url" ||
    normalizedName === "linkedin_company_page" ||
    normalizedName === "facebook" ||
    normalizedName === "hs_logo_url" ||
    normalizedLabel.includes("url")
  ) {
    return "url";
  }

  if (normalizedName === "phone" || normalizedName === "mobilephone") {
    return "tel";
  }

  if (type === "number") {
    return "number";
  }

  if (type === "datetime") {
    return "datetime";
  }

  return "text";
}

function determineIsReadOnly(name: string, acceptedValues: string) {
  const normalizedName = name.toLowerCase();
  const normalizedAccepted = acceptedValues.toLowerCase();

  if (normalizedName === "createdate" || normalizedName === "hs_object_id" || normalizedName === "hs_lastmodifieddate") {
    return true;
  }

  if (normalizedAccepted.includes("system-managed") || normalizedAccepted.includes("system numeric")) {
    return true;
  }

  return false;
}

function parsePropertyRows(lines: string[], objectType: "contact" | "company") {
  const parsed: HubSpotPropertyDefinition[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!line.trim().startsWith("|") || line.trim().startsWith("|---")) {
      continue;
    }

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 5) {
      continue;
    }

    const label = cells[0];
    const name = cells[1].replace(/`/g, "").trim();
    const rawType = cells[2].trim().toLowerCase();
    const acceptedValues = cells[3].trim();
    const primary = cells[4].toLowerCase().includes("primary");

    if (!name || seen.has(`${objectType}:${name}`)) {
      continue;
    }

    seen.add(`${objectType}:${name}`);

    const type = rawType.includes("enum")
      ? "enumeration"
      : rawType.includes("number")
      ? "number"
      : rawType.includes("date")
      ? "datetime"
      : "string";

    const options = type === "enumeration" ? parseEnumOptions(acceptedValues) : undefined;
    const format = determineFormat(name, type, label);
    const readonly = determineIsReadOnly(name, acceptedValues);

    parsed.push({
      label,
      name,
      type,
      format,
      objectType,
      primary,
      readonly,
      options,
    });
  }

  return parsed;
}

function getSectionLines(content: string, heading: string, nextHeading: string) {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) return [];

  const endIndex = lines.findIndex((line, index) => index > startIndex && line.trim() === nextHeading);
  return lines.slice(startIndex + 1, endIndex === -1 ? undefined : endIndex);
}

export function getHubspotPropertyDefinitions(): HubSpotPropertyDefinition[] {
  const content = fs.readFileSync(propertyFilePath, "utf8");
  const contactLines = getSectionLines(content, "## Contacts", "## Companies");
  const companyLines = getSectionLines(content, "## Companies", "## Quick shortlist of the most important \"primary/core\" fields by object");

  return [
    ...parsePropertyRows(contactLines, "contact"),
    ...parsePropertyRows(companyLines, "company"),
  ];
}

export function getHubspotPropertyOptions(): HubSpotPropertyOption[] {
  const definitions = getHubspotPropertyDefinitions();
  const seen = new Set<string>();
  const options: HubSpotPropertyOption[] = [];

  for (const definition of definitions) {
    if (definition.readonly) {
      continue;
    }

    if (!seen.has(definition.name)) {
      seen.add(definition.name);
      options.push({ label: definition.label, value: definition.name });
    }
  }

  return options;
}

export function getPropertyDefinitionsByObject(objectType: "contact" | "company") {
  return getHubspotPropertyDefinitions().filter((definition) => definition.objectType === objectType);
}

export function getHubspotPropertyDefinitionByName(name: string) {
  return getHubspotPropertyDefinitions().find((definition) => definition.name === name);
}

export function filterWritableProperties(
  properties: Record<string, unknown> | undefined,
  objectType: "contact" | "company",
): HubSpotProperties {
  if (!properties) {
    return {};
  }

  const definitions = new Map(
    getPropertyDefinitionsByObject(objectType).map((definition) => [definition.name, definition]),
  );

  return Object.entries(properties).reduce<HubSpotProperties>((acc, [key, value]) => {
    if (value === undefined || value === null || value === "") {
      return acc;
    }

    const definition = definitions.get(key);
    if (!definition || definition.readonly) {
      return acc;
    }

    if (definition.name === "hubspot_owner_id") {
      const stringValue = String(value).trim();
      if (!/^[0-9]+$/.test(stringValue)) {
        throw new Error("Invalid owner ID. Owner IDs must contain only numeric characters.");
      }
      acc[key] = stringValue;
      return acc;
    }

    if (definition.type === "enumeration" && definition.options?.length) {
      const stringValue = String(value);
      if (!definition.options.some((option) => option.value === stringValue)) {
        throw new Error(`Selected value is not allowed for ${definition.label}.`);
      }
      acc[key] = stringValue;
      return acc;
    }

    acc[key] = value as string | number | boolean;
    return acc;
  }, {});
}
