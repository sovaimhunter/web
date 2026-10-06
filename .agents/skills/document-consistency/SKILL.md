---
name: document-consistency
description: Rules for comparing fields across uploaded export documents.
version: 1

# Risk drives severity when a field disagrees across documents:
#   high   -> must_fix
#   medium -> review
#   low    -> display only (no issue)
# needs_human_review=true -> the field is surfaced for a human to confirm
#   even when every document agrees.
fields:
  exporter:
    needs_human_review: true
    risk: high
    guidance: "Confirm the exporter's legal name and suffix on every document."
  consignee:
    needs_human_review: true
    risk: high
    guidance: "Confirm the consignee's legal name with the buyer."
  description_of_goods:
    needs_human_review: false
    risk: medium
    guidance: "Confirm product type, material and quantity describe the same goods."
  hs_code:
    needs_human_review: true
    risk: high
    guidance: "Confirm the HS/AHECC code with a customs broker."
  country_of_origin:
    needs_human_review: false
    risk: medium
  incoterms:
    needs_human_review: false
    risk: medium
  port_of_loading:
    needs_human_review: false
    risk: medium
  port_of_discharge:
    needs_human_review: false
    risk: medium
  vessel:
    needs_human_review: false
    risk: low
  unit_quantity:
    needs_human_review: false
    risk: high
    guidance: "Confirm the shipped quantity and unit of measure."
  number_of_packages:
    needs_human_review: false
    risk: high
  net_weight_kg:
    needs_human_review: false
    risk: medium
  gross_weight_kg:
    needs_human_review: false
    risk: medium
  total_amount:
    needs_human_review: false
    risk: high
    guidance: "Recalculate the invoice lines and confirm the sale value."
  currency:
    needs_human_review: false
    risk: high
    guidance: "Confirm the transaction currency in the contract."
  line_items:
    needs_human_review: false
    risk: high

# Cross-field rules are deterministic checks executed in code; `check` is the
# human/agent-readable statement of what the rule verifies.
cross_field_rules:
  - id: invoice_total_matches_lines
    severity: must_fix
    description: "Line items do not sum to the stated total."
    check: "sum(line_items[].amount) == total_amount"
  - id: net_not_over_gross
    severity: review
    description: "Net weight is greater than gross weight."
    check: "net_weight_kg <= gross_weight_kg"
---

# Document Consistency

You compare fields across the user's uploaded export documents.

- Do NOT assume document types. Read whatever files are provided.
- Extract fields as they appear; return `null` for anything absent.
- A field that appears in only one document is displayed, not flagged.
- Fields that appear in two or more documents are compared using the rules
  above. `risk` sets the severity; `needs_human_review` means the field must be
  shown to a human even when consistent.
- Values outside the typed core fields are kept and compared generically.
