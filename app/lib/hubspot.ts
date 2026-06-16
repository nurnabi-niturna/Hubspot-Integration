import axios from "axios";

export function createHubspotClient(accessToken?: string) {
  const token = accessToken?.trim() || process.env.HUBSPOT_ACCESS_TOKEN?.trim();

  return axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
  });
}

export const hubspot = createHubspotClient();
