"use client";

import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { HubspotAccessGate, type HubspotAccessState } from "@/components/hubspot-access-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import type { HubSpotPropertyDefinition } from "@/lib/hubspotProperties";

type PreviewRow = { id: string; [key: string]: string };
type MappingValue = "" | `${"contact" | "company"}:${string}`;
type ImportStep = "upload" | "mapping" | "summary" | "result";

interface CsvImporterProps {
  contactProperties: HubSpotPropertyDefinition[];
  companyProperties: HubSpotPropertyDefinition[];
}

interface ImportResult {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  errorRows: Array<{ rowIndex: number; message: string; row?: Record<string, unknown> }>;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const numberPattern = /^-?\d+(\.\d+)?$/;

function rowId() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inferMapping(column: string, contactProperties: HubSpotPropertyDefinition[], companyProperties: HubSpotPropertyDefinition[]): MappingValue {
  const normalized = normalize(column);
  const aliases: Record<string, MappingValue> = {
    email: "contact:email",
    firstname: "contact:firstname",
    first: "contact:firstname",
    lastname: "contact:lastname",
    last: "contact:lastname",
    phone: "contact:phone",
    mobile: "contact:mobilephone",
    jobtitle: "contact:jobtitle",
    title: "contact:jobtitle",
    company: "company:name",
    companyname: "company:name",
    name: "company:name",
    domain: "company:domain",
    companydomain: "company:domain",
    website: "company:website",
    city: "contact:city",
    state: "contact:state",
    country: "contact:country",
    linkedin: "contact:hs_linkedin_url",
    facebook: "contact:facebook",
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  const allProperties = [
    ...contactProperties.map((property) => ({ objectType: "contact" as const, property })),
    ...companyProperties.map((property) => ({ objectType: "company" as const, property })),
  ];
  const match = allProperties.find(({ property }) => normalize(property.label) === normalized || normalize(property.name) === normalized);
  return match ? `${match.objectType}:${match.property.name}` : "";
}

function coerceEnum(value: string, property: HubSpotPropertyDefinition) {
  const trimmed = value.trim();
  if (!property.options?.length || !trimmed) {
    return trimmed;
  }

  const exact = property.options.find((option) => option.value === trimmed || option.label === trimmed);
  if (exact) {
    return exact.value;
  }

  const loose = property.options.find((option) => normalize(option.value) === normalize(trimmed) || normalize(option.label) === normalize(trimmed));
  return loose?.value ?? trimmed;
}

function buildPayload(
  row: PreviewRow,
  columns: string[],
  mapping: Record<string, MappingValue>,
  propertyMap: Map<string, HubSpotPropertyDefinition>,
) {
  const contact: Record<string, string> = {};
  const company: Record<string, string> = {};

  for (const column of columns) {
    const target = mapping[column];
    const rawValue = String(row[column] ?? "").trim();
    if (!target || !rawValue) continue;

    const [objectType, propertyName] = target.split(":") as ["contact" | "company", string];
    const definition = propertyMap.get(target);
    const value = definition ? coerceEnum(rawValue, definition) : rawValue;

    if (objectType === "contact") {
      contact[propertyName] = value;
    } else {
      company[propertyName] = value;
    }
  }

  return {
    contact: Object.keys(contact).length ? contact : undefined,
    company: Object.keys(company).length ? company : undefined,
  };
}

function validatePayload(
  row: PreviewRow,
  columns: string[],
  mapping: Record<string, MappingValue>,
  propertyMap: Map<string, HubSpotPropertyDefinition>,
) {
  const errors: string[] = [];
  const payload = buildPayload(row, columns, mapping, propertyMap);

  if (!payload.contact && !payload.company) {
    errors.push("Map at least one column for this row.");
  }

  if (payload.contact) {
    if (!payload.contact.email) {
      errors.push("Email is required for contact import.");
    } else if (!emailPattern.test(payload.contact.email)) {
      errors.push("Email format is invalid.");
    }
  }

  if (payload.company && !payload.company.name && !payload.company.domain) {
    errors.push("Company name or domain is required for company import.");
  }

  for (const column of columns) {
    const target = mapping[column];
    const value = String(row[column] ?? "").trim();
    if (!target || !value) continue;

    const property = propertyMap.get(target);
    if (!property) continue;

    if (property.format === "number" && !numberPattern.test(value)) {
      errors.push(`${column}: value must be numeric.`);
    }

    if (property.type === "enumeration" && property.options?.length) {
      const coerced = coerceEnum(value, property);
      if (!property.options.some((option) => option.value === coerced)) {
        errors.push(`${column}: selected value is not allowed for ${property.label}.`);
      }
    }
  }

  return errors;
}

export function CsvImporter({ contactProperties, companyProperties }: CsvImporterProps) {
  const writableContactProperties = contactProperties.filter((property) => !property.readonly);
  const writableCompanyProperties = companyProperties.filter((property) => !property.readonly);
  const [access, setAccess] = useState<HubspotAccessState>({ accessToken: "", validated: false, scopes: [], missingRecommendedScopes: [] });
  const [step, setStep] = useState<ImportStep>("upload");
  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, MappingValue>>({});
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const propertyOptions = useMemo(
    () => [
      ...writableContactProperties.map((property) => ({ label: `Contact - ${property.label}`, value: `contact:${property.name}` })),
      ...writableCompanyProperties.map((property) => ({ label: `Company - ${property.label}`, value: `company:${property.name}` })),
    ],
    [writableContactProperties, writableCompanyProperties],
  );

  const propertyMap = useMemo(() => {
    const entries = [
      ...writableContactProperties.map((property) => [`contact:${property.name}`, property] as const),
      ...writableCompanyProperties.map((property) => [`company:${property.name}`, property] as const),
    ];
    return new Map(entries);
  }, [writableContactProperties, writableCompanyProperties]);

  const rowValidation = useMemo(
    () =>
      rows.reduce<Record<string, string[]>>((acc, row) => {
        acc[row.id] = validatePayload(row, columns, mapping, propertyMap);
        return acc;
      }, {}),
    [rows, columns, mapping, propertyMap],
  );

  const invalidRows = Object.values(rowValidation).filter((errors) => errors.length > 0).length;
  const validRows = rows.length - invalidRows;
  const mappedRows = rows.map((row) => buildPayload(row, columns, mapping, propertyMap));
  const contactsToCreate = mappedRows.filter((row) => row.contact).length;
  const companiesToCreate = mappedRows.filter((row) => row.company).length;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setToast({ type: "error", message: "Upload one CSV file. XLSX is no longer accepted in this flow." });
      return;
    }

    setIsParsing(true);
    setResult(null);

    try {
      const text = await file.text();
      const workbook = XLSX.read(text, { type: "string" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Array<string | number | null>>(worksheet, { header: 1, defval: "" });
      const header = (rawRows[0] || []).map((value, index) => String(value || `Column ${index + 1}`).trim());

      if (!header.length || rawRows.length < 2) {
        throw new Error("The CSV must include a header row and at least one data row.");
      }

      const parsedRows = rawRows.slice(1).map((rawRow) => {
        const next: PreviewRow = { id: rowId() };
        header.forEach((column, index) => {
          next[column] = String(rawRow[index] ?? "");
        });
        return next;
      });

      const inferredMapping = header.reduce<Record<string, MappingValue>>((acc, column) => {
        acc[column] = inferMapping(column, writableContactProperties, writableCompanyProperties);
        return acc;
      }, {});

      setFileName(file.name);
      setColumns(header);
      setRows(parsedRows);
      setMapping(inferredMapping);
      setStep("mapping");
      setToast({ type: "success", message: `${parsedRows.length} CSV rows loaded. Review mappings before import.` });
    } catch (error: unknown) {
      const err = error as { message?: string };
      setToast({ type: "error", message: err.message || "Unable to read this CSV file." });
      setColumns([]);
      setRows([]);
      setMapping({});
      setFileName("");
      setStep("upload");
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  }

  function updateCell(rowIdValue: string, column: string, value: string) {
    setRows((current) => current.map((row) => (row.id === rowIdValue ? { ...row, [column]: value } : row)));
  }

  function addRow() {
    const next = columns.reduce<PreviewRow>((acc, column) => {
      acc[column] = "";
      return acc;
    }, { id: rowId() });
    setRows((current) => [...current, next]);
  }

  function deleteRow(rowIdValue: string) {
    setRows((current) => current.filter((row) => row.id !== rowIdValue));
  }

  async function submitImport() {
    if (!access.validated) {
      setToast({ type: "error", message: "Validate your HubSpot private app access token first." });
      return;
    }

    if (invalidRows > 0 || !rows.length) {
      setToast({ type: "error", message: "Fix invalid rows before importing." });
      return;
    }

    setIsSubmitting(true);
    try {
      const payloadRows = rows.map((row) => buildPayload(row, columns, mapping, propertyMap));
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: access.accessToken, rows: payloadRows }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Import failed.");
      }

      setResult({
        totalProcessed: data.totalProcessed ?? rows.length,
        successCount: data.successCount ?? 0,
        failureCount: data.failureCount ?? 0,
        errorRows: data.errorRows ?? [],
      });
      setStep("result");
      setToast({ type: data.failureCount ? "error" : "success", message: data.message || "Import complete." });
    } catch (error: unknown) {
      const err = error as { message?: string };
      setToast({ type: "error", message: err.message || "Import failed." });
    } finally {
      setIsSubmitting(false);
    }
  }

  function downloadErrors() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.errorRows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "hubspot-import-errors.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 sm:px-10 lg:px-16">
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white p-8 shadow-xl shadow-slate-900/5 sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">CSV Import</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">Map one CSV into HubSpot contacts and companies.</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
            Validate access, upload a CSV, map columns to HubSpot properties, correct rows in the browser, then import.
          </p>
        </section>

        <HubspotAccessGate compact onAccessChange={setAccess} />

        <Card>
          <CardHeader>
            <CardTitle>1. Upload CSV</CardTitle>
            <CardDescription>Upload a single .csv file. The app reads it locally and never submits until you review the mapping and summary.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <label className="block rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
              <span className="font-semibold text-slate-950">Choose CSV file</span>
              <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="mt-4 w-full cursor-pointer" />
            </label>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
              <p className="font-semibold text-slate-950">{fileName || "No file selected"}</p>
              <p className="mt-2">{isParsing ? "Reading CSV..." : rows.length ? `${rows.length} rows loaded` : "Rows appear after upload."}</p>
            </div>
          </CardContent>
        </Card>

        {columns.length ? (
          <Card>
            <CardHeader>
              <CardTitle>2. Map columns</CardTitle>
              <CardDescription>Every mapping is editable. Unmapped columns are ignored during import.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {columns.map((column) => (
                <div key={column} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-2 text-sm font-semibold text-slate-950">{column}</p>
                  <Select
                    label=""
                    options={propertyOptions}
                    searchable
                    value={mapping[column] || ""}
                    onValueChange={(value) => setMapping((current) => ({ ...current, [column]: value as MappingValue }))}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {rows.length ? (
          <Card>
            <CardHeader>
              <CardTitle>3. Edit and validate rows</CardTitle>
              <CardDescription>Fix highlighted rows directly here. You do not need to upload again.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <span className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm">Total rows: {rows.length}</span>
                <span className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">Valid rows: {validRows}</span>
                <span className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">Invalid rows: {invalidRows}</span>
                <Button type="button" variant="secondary" onClick={addRow}>Add row</Button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                  <thead className="bg-slate-950 text-white">
                    <tr>
                      {columns.map((column) => (
                        <th key={column} className="px-4 py-3 font-semibold">{column}</th>
                      ))}
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const errors = rowValidation[row.id] || [];
                      return (
                        <React.Fragment key={row.id}>
                          <tr className={errors.length ? "bg-rose-50" : index % 2 ? "bg-white" : "bg-slate-50"}>
                            {columns.map((column) => (
                              <td key={`${row.id}-${column}`} className="border-b border-slate-200 px-3 py-3 align-top">
                                <input
                                  value={row[column] || ""}
                                  onChange={(event) => updateCell(row.id, column, event.target.value)}
                                  className="h-10 min-w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                                />
                              </td>
                            ))}
                            <td className="border-b border-slate-200 px-3 py-3 align-top">
                              <Button type="button" variant="outline" size="sm" onClick={() => deleteRow(row.id)}>Delete</Button>
                            </td>
                          </tr>
                          {errors.length ? (
                            <tr className="bg-rose-50">
                              <td colSpan={columns.length + 1} className="border-b border-rose-100 px-4 py-3 text-sm text-rose-700">
                                {errors.join(" ")}
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {rows.length ? (
          <Card>
            <CardHeader>
              <CardTitle>4. Import summary</CardTitle>
              <CardDescription>Review what will be sent to HubSpot before any API request is made.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ["Total Rows", rows.length],
                  ["Valid Rows", validRows],
                  ["Invalid Rows", invalidRows],
                  ["Contacts To Create/Update", contactsToCreate],
                  ["Companies To Create/Update", companiesToCreate],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                size="lg"
                isLoading={isSubmitting}
                disabled={!access.validated || invalidRows > 0 || !validRows || isSubmitting}
                onClick={submitImport}
              >
                {isSubmitting ? "Importing..." : "Import to HubSpot"}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {step === "result" && result ? (
          <Card>
            <CardHeader>
              <CardTitle>Import result</CardTitle>
              <CardDescription>Processed rows and row-level failures.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Total Processed: {result.totalProcessed}</div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">Success Count: {result.successCount}</div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">Failure Count: {result.failureCount}</div>
              </div>
              <Button type="button" variant="outline" disabled={!result.errorRows.length} onClick={downloadErrors}>
                Download error report JSON
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {toast ? <Toast type={toast.type} message={toast.message} visible /> : null}
    </main>
  );
}
