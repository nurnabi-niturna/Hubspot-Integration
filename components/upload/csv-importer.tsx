"use client";

import React, { useMemo, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { HubspotAccessGate, type HubspotAccessState } from "@/components/hubspot-access-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import type { HubSpotPropertyDefinition } from "@/lib/hubspotProperties";

type PreviewRow = { id: string; [key: string]: string };
type ImportStep = "upload" | "mapping" | "summary" | "result";
type ImportObjectType = "contact" | "company";

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

function inferMapping(column: string, properties: HubSpotPropertyDefinition[]): string {
  const normalized = normalize(column);
  
  for (const prop of properties) {
    if (normalize(prop.name) === normalized || normalize(prop.label) === normalized) {
      return prop.name;
    }
  }

  const aliases: Record<string, string[]> = {
    email: ["email", "emailaddress", "mail"],
    firstname: ["firstname", "first", "fname"],
    lastname: ["lastname", "last", "lname"],
    phone: ["phone", "phonenumber", "telephone"],
    mobilephone: ["mobile", "mobilephone", "cellphone"],
    jobtitle: ["jobtitle", "title", "role"],
    company: ["company", "companyname", "org", "organization"],
    name: ["companyname", "name", "company"],
    domain: ["domain", "companydomain", "website"],
    website: ["website", "site", "webaddress", "url"],
  };

  for (const prop of properties) {
    const propertyAliases = aliases[prop.name] || [];
    if (propertyAliases.includes(normalized)) {
      return prop.name;
    }
  }

  return "";
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

function buildPayloadForObjectType(
  row: PreviewRow,
  mapping: Record<string, string>,
  properties: HubSpotPropertyDefinition[],
) {
  const payload: Record<string, string> = {};
  const propertyMap = new Map(properties.map((p) => [p.name, p]));

  for (const [csvColumn, propertyName] of Object.entries(mapping)) {
    if (!propertyName) continue;
    const rawValue = String(row[csvColumn] ?? "").trim();
    if (!rawValue) continue;
    const property = propertyMap.get(propertyName);
    const value = property ? coerceEnum(rawValue, property) : rawValue;
    payload[propertyName] = value;
  }
  return payload;
}

function validatePayloadForObjectType(
  row: PreviewRow,
  mapping: Record<string, string>,
  properties: HubSpotPropertyDefinition[],
  objectType: ImportObjectType,
) {
  const errors: string[] = [];
  const payload = buildPayloadForObjectType(row, mapping, properties);
  const propertyMap = new Map(properties.map((p) => [p.name, p]));

  if (objectType === "contact") {
    if (!payload.email) {
      errors.push("Email is required for contact import.");
    } else if (!emailPattern.test(payload.email)) {
      errors.push("Email format is invalid.");
    }
  } else {
    if (!payload.name && !payload.domain) {
      errors.push("Company name or domain is required for company import.");
    }
  }

  for (const [csvColumn, propertyName] of Object.entries(mapping)) {
    if (!propertyName) continue;
    const value = String(row[csvColumn] ?? "").trim();
    if (!value) continue;

    const property = propertyMap.get(propertyName);
    if (!property) continue;

    if (property.format === "number" && !numberPattern.test(value)) {
      errors.push(`${csvColumn}: value must be numeric.`);
    }

    if (property.type === "enumeration" && property.options?.length) {
      const coerced = coerceEnum(value, property);
      if (!property.options.some((option) => option.value === coerced)) {
        errors.push(`${csvColumn}: selected value is not allowed for ${property.label}.`);
      }
    }
  }

  return errors;
}

export function CsvImporter({ contactProperties, companyProperties }: CsvImporterProps) {
  const writableContactProperties = useMemo(() => contactProperties.filter((property) => !property.readonly), [contactProperties]);
  const writableCompanyProperties = useMemo(() => companyProperties.filter((property) => !property.readonly), [companyProperties]);

  const [access, setAccess] = useState<HubspotAccessState>({ accessToken: "", validated: false, scopes: [], missingRecommendedScopes: [] });
  const [importObjectType, setImportObjectType] = useState<ImportObjectType | null>(null);
  const [step, setStep] = useState<ImportStep>("upload");
  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // csvColumn -> HubSpot Property Name
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const [dynamicProperties, setDynamicProperties] = useState<HubSpotPropertyDefinition[]>([]);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);

  useEffect(() => {
    if (!access.validated || !importObjectType) {
      setDynamicProperties([]);
      return;
    }

    async function fetchProperties() {
      setIsLoadingProperties(true);
      try {
        const response = await fetch("/api/hubspot/properties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: access.accessToken,
            objectType: importObjectType === "contact" ? "contacts" : "companies",
          }),
        });
        const result = await response.json();
        if (result.success && Array.isArray(result.properties)) {
          const mapped: HubSpotPropertyDefinition[] = result.properties.map((prop: any) => ({
            name: prop.name,
            label: prop.label,
            type: prop.type === "enumeration" ? "enumeration" : prop.type === "number" ? "number" : prop.type === "datetime" ? "datetime" : "string",
            format: prop.name === "email" ? "email" : (prop.name === "phone" || prop.name === "mobilephone") ? "tel" : "text",
            objectType: importObjectType,
            primary: prop.name === "email" || prop.name === "name" || prop.name === "domain",
            readonly: prop.readonly,
            options: prop.options,
          }));
          setDynamicProperties(mapped);
        } else {
          setDynamicProperties(importObjectType === "contact" ? contactProperties : companyProperties);
        }
      } catch (error) {
        console.error("Failed to fetch dynamic properties, using static fallback", error);
        setDynamicProperties(importObjectType === "contact" ? contactProperties : companyProperties);
      } finally {
        setIsLoadingProperties(false);
      }
    }

    fetchProperties();
  }, [access.validated, access.accessToken, importObjectType, contactProperties, companyProperties]);

  const activeProperties = useMemo(() => {
    if (!importObjectType) return [];
    if (dynamicProperties.length > 0) {
      return dynamicProperties.filter((property) => !property.readonly);
    }
    return importObjectType === "contact" ? writableContactProperties : writableCompanyProperties;
  }, [importObjectType, dynamicProperties, writableContactProperties, writableCompanyProperties]);

  const hubspotPropertyOptions = useMemo(() => {
    return [
      { label: "Do Not Map", value: "" },
      ...activeProperties.map((prop) => ({
        label: prop.label || prop.name,
        value: prop.name,
      })),
    ];
  }, [activeProperties]);

  const rowValidation = useMemo(
    () => {
      if (!importObjectType) return {};
      return rows.reduce<Record<string, string[]>>((acc, row) => {
        acc[row.id] = validatePayloadForObjectType(row, mapping, activeProperties, importObjectType);
        return acc;
      }, {});
    },
    [rows, mapping, activeProperties, importObjectType],
  );

  const invalidRows = Object.values(rowValidation).filter((errors) => errors.length > 0).length;
  const validRows = rows.length - invalidRows;
  const contactsToCreate = importObjectType === "contact" ? rows.length : 0;
  const companiesToCreate = importObjectType === "company" ? rows.length : 0;

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

      const inferredMapping = header.reduce<Record<string, string>>((acc, column) => {
        acc[column] = inferMapping(column, activeProperties);
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
      const payloadRows = rows.map((row) => {
        const payload = buildPayloadForObjectType(row, mapping, activeProperties);
        return {
          contact: importObjectType === "contact" ? payload : undefined,
          company: importObjectType === "company" ? payload : undefined,
        };
      });

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
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">Map one CSV into HubSpot contacts or companies.</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
            Validate access, choose object type, upload a CSV, map properties to CSV columns, correct rows in the browser, then import.
          </p>
        </section>

        <HubspotAccessGate compact onAccessChange={setAccess} />

        <div className="rounded-[2rem] border border-slate-200/80 bg-white p-8 shadow-sm shadow-slate-900/5">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 mb-4">Object Type Selection</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                id: "contact" as ImportObjectType,
                title: "Contacts Import",
                description: "Import records as HubSpot contacts.",
                icon: "👤",
              },
              {
                id: "company" as ImportObjectType,
                title: "Companies Import",
                description: "Import records as HubSpot companies.",
                icon: "🏢",
              },
            ].map((option) => {
              const selected = importObjectType === option.id;
              return (
                <div
                  key={option.id}
                  onClick={() => {
                    if (step !== "upload") {
                      setFileName("");
                      setColumns([]);
                      setRows([]);
                      setMapping({});
                      setStep("upload");
                    }
                    setImportObjectType(option.id);
                  }}
                  className={`group cursor-pointer rounded-2xl border p-5 transition duration-300 ${
                    selected
                      ? "border-slate-900 bg-slate-950/5 shadow-md ring-2 ring-slate-900"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-2xl">{option.icon}</span>
                    <div>
                      <h3 className="font-semibold text-slate-950">{option.title}</h3>
                      <p className="text-xs text-slate-500 mt-1">{option.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {importObjectType ? (
          <Card>
            <CardHeader>
              <CardTitle>1. Upload CSV</CardTitle>
              <CardDescription>
                Upload a single .csv file for the selected {importObjectType === "contact" ? "contacts" : "companies"} flow.
                {isLoadingProperties && " (Fetching properties from HubSpot...)"}
              </CardDescription>
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
        ) : null}

        {columns.length && importObjectType ? (
          <Card>
            <CardHeader>
              <CardTitle>2. Map properties</CardTitle>
              <CardDescription>Map CSV columns to any HubSpot {importObjectType === "contact" ? "Contact" : "Company"} property.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {columns.map((column) => (
                <div key={column} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-col justify-between">
                  <div className="mb-2">
                    <p className="text-sm font-semibold text-slate-950">{column}</p>
                  </div>
                  <Select
                    label=""
                    options={hubspotPropertyOptions}
                    searchable
                    value={mapping[column] || ""}
                    onValueChange={(value) => setMapping((current) => ({ ...current, [column]: value }))}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {rows.length && importObjectType ? (
          <Card>
            <CardHeader>
              <CardTitle>3. Edit and validate rows</CardTitle>
              <CardDescription>Fix highlighted rows directly in the cells. Corrected values are saved instantly for import.</CardDescription>
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

        {rows.length && importObjectType ? (
          <Card>
            <CardHeader>
              <CardTitle>4. Import summary</CardTitle>
              <CardDescription>Review the statistics before submitting to HubSpot.</CardDescription>
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
