// SAMPLE / fictional data — the fields an AI extracted from the three PDFs.
// These are the REAL values our Python spike pulled out of the documents.
// (Used when EXTRACTION_MODE=mock, or as reference data for the UI.)

import type { DocFields, DocKey } from "./types";

export { DOC_NAMES } from "./types";

export const documents: Record<DocKey, DocFields> = {
  invoice: {
    exporter: "Outback Origins Art Co., 42 Todd Street, Alice Springs NT 0870, Australia",
    consignee: "Galerie Nordlicht GmbH Auguststrasse 19, 10117 Berlin, Germany",
    description_of_goods: "Aboriginal acrylic on linen",
    hs_code: "9701.21",
    country_of_origin: "Australia",
    incoterms: "CIP Berlin, Germany",
    port_of_loading: "Sydney, Australia",
    port_of_discharge: "Hamburg, Germany",
    vessel: "MV Southern Star",
    unit_quantity: 3,
    number_of_packages: null,
    net_weight_kg: null,
    gross_weight_kg: null,
    total_amount: 24500,
    line_items: [
      { description: "Desert Waterholes", quantity: 1, unit_price: 9500, amount: 9500 },
      { description: "Bush Tucker Dreaming", quantity: 1, unit_price: 7000, amount: 7000 },
      { description: "Seven Sisters Songline", quantity: 1, unit_price: 8000, amount: 8000 },
    ],
  },
  packing_list: {
    exporter: "Outback Origins Art Co., 42 Todd Street, Alice Springs NT 0870, Australia",
    consignee: "Galerie Nordlicht GmbH Auguststrasse 19, 10117 Berlin, Germany",
    description_of_goods: "Aboriginal acrylic paintings on canvas (3 pcs)",
    hs_code: null,
    country_of_origin: "Australia",
    incoterms: null,
    port_of_loading: "Sydney, Australia",
    port_of_discharge: "Hamburg, Germany",
    vessel: "MV Southern Star",
    unit_quantity: 3,
    number_of_packages: "1 wooden crate",
    net_weight_kg: 12,
    gross_weight_kg: 18.5,
    total_amount: null,
    line_items: null,
  },
  bill_of_lading: {
    exporter: "Outback Origins Art Co., 42 Todd Street, Alice Springs NT 0870, Australia",
    consignee: "Galerie Nordlicht Gmbh Auguststrasse 19, 10117 Berlin, Germany", // planted: lowercase b
    description_of_goods: "Three (3) original Aboriginal acrylic paintings, crated",
    hs_code: null,
    country_of_origin: null,
    incoterms: null,
    port_of_loading: "Sydney, Australia",
    port_of_discharge: null,
    vessel: "MV Southern Star",
    unit_quantity: null,
    number_of_packages: "2 packages", // planted mismatch
    net_weight_kg: 12,
    gross_weight_kg: 18.0, // planted mismatch
    total_amount: null,
    line_items: null,
  },
};
