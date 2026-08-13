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
  line_items: LineItem[] | null;
};

export type DocKey = "invoice" | "packing_list" | "bill_of_lading";

export const DOC_KEYS: DocKey[] = ["invoice", "packing_list", "bill_of_lading"];

export const DOC_NAMES: Record<DocKey, string> = {
  invoice: "Commercial Invoice",
  packing_list: "Packing List",
  bill_of_lading: "Bill of Lading",
};

export type Severity = "error" | "warning";

export type FieldStatus = "match" | "review" | "mismatch";

export type Issue = {
  severity: Severity;
  field: string;
  message: string;
  detail: Record<string, string>;
};

export type FieldRow = {
  field: string;
  key: string;
  vals: Record<DocKey, string | number | null>;
  consistent: boolean;
  status: FieldStatus;
  outliers: DocKey[];
  reference: string | number | null;
};

export type ComparisonResult = {
  documents: Record<DocKey, DocFields>;
  issues: Issue[];
  rows: FieldRow[];
};

export type CheckResult = ComparisonResult & {
  files: Record<DocKey, string>;
};
