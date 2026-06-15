import { getPropertyDefinitionsByObject } from "@/lib/hubspotProperties.server";
import { ManualEntryForm } from "@/components/manual-entry/manual-entry-form";

const contactProperties = getPropertyDefinitionsByObject("contact");
const companyProperties = getPropertyDefinitionsByObject("company");

export default function ManualEntryPage() {
  return <ManualEntryForm contactProperties={contactProperties} companyProperties={companyProperties} />;
}
