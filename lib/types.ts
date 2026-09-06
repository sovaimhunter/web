export type LineItem = {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
};

export type DocFields = {
  exporter: string | null;
  consignee: string | null;
  description_of_goods: string | null;
  hs_code: string | null;
  country_of_origin: string | null;
  incoterms: string | null;
  port_of_loading: string | null;
  port_of_discharge: string | null;
  vessel: string | null;
  unit_quantity: number | null;
  number_of_packages: string | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
  total_amount: number | null;
  currency: string | null;
  line_items: LineItem[] | null;
};

export type DocKey = "invoice" | "packing_list" | "bill_of_lading";

/**
 * Vercel Functions reject request bodies over 4.5 MB with a 413 before the
 * handler runs, so the three PDFs must fit under that combined. Kept at 4 MB
 * to leave room for multipart overhead.
 */
export const MAX_UPLOAD_TOTAL_BYTES = 4 * 1024 * 1024;

export const DOC_KEYS: DocKey[] = ["invoice", "packing_list", "bill_of_lading"];

export const DOC_NAMES: Record<DocKey, string> = {
  invoice: "Commercial Invoice",
  packing_list: "Packing List",
  bill_of_lading: "Bill of Lading",
};

export type CheckStatus = "must_fix" | "review" | "passed";

export type ActionableCheckStatus = Exclude<CheckStatus, "passed">;

export type Issue = {
  status: ActionableCheckStatus;
  field: string;
  message: string;
  detail: Record<string, string>;
};

export type FieldRow = {
  field: string;
  key: string;
  vals: Record<DocKey, string | number | null>;
  consistent: boolean;
  status: CheckStatus;
  outliers: DocKey[];
  reference: string | number | null;
};

export type ComparisonResult = {
  documents: Record<DocKey, DocFields>;
  issues: Issue[];
  rows: FieldRow[];
};

export type CheckResult = ComparisonResult & {
  outcome: "completed";
  files: Record<DocKey, string>;
};

export type FailedCheckResult = {
  outcome: "failed";
  files: Partial<Record<DocKey, string>>;
  failures: CheckFailure[];
};

export type StoredCheckResult = CheckResult | FailedCheckResult;

export type CheckFailureStage = "upload" | "extraction" | "comparison";

export type CheckFailureCode =
  | "INVALID_REQUEST"
  | "MISSING_DOCUMENT"
  | "INVALID_FILE_TYPE"
  | "EMPTY_FILE"
  | "UPLOAD_TOO_LARGE"
  | "UNREADABLE_PDF"
  | "NO_FIELDS_EXTRACTED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "EXTRACTION_FAILED"
  | "CHECK_FAILED"
  | "NETWORK_ERROR";

export type CheckFailure = {
  code: CheckFailureCode;
  stage: CheckFailureStage;
  message: string;
  action: string;
  retryable: boolean;
  document?: DocKey;
};

export type CheckErrorResponse = {
  error: string;
  failures: CheckFailure[];
};
