export type HubSpotPropertyType = "string" | "number" | "datetime" | "enumeration";
export type HubSpotPropertyFormat = "text" | "email" | "url" | "tel" | "number" | "datetime";

export interface HubSpotPropertyOption {
  label: string;
  value: string;
}

export interface HubSpotPropertyDefinition {
  label: string;
  name: string;
  type: HubSpotPropertyType;
  format: HubSpotPropertyFormat;
  objectType: "contact" | "company";
  primary: boolean;
  options?: HubSpotPropertyOption[];
}
