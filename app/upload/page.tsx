import { CsvImporter } from "@/components/upload/csv-importer";
import { getPropertyDefinitionsByObject } from "@/lib/hubspotProperties.server";

const contactProperties = getPropertyDefinitionsByObject("contact");
const companyProperties = getPropertyDefinitionsByObject("company");

export default function UploadPage() {
  return <CsvImporter contactProperties={contactProperties} companyProperties={companyProperties} />;
}
