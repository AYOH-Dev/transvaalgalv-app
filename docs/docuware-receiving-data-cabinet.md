# DocuWare Receiving Data Cabinet

## Verified Export

- Export file: `docs/Receiving Data 4_17_2026 1_26_36 PM.xml`
- Cabinet name: `Receiving Data`
- Cabinet id: `198`
- Total fields: `104`
- Custom writable business fields: `79`
- System fields: `25`
- Table fields: none
- Store dialogs: none in export
- Result dialogs: none in export
- Select lists: none in export

## What This Export Proves

1. This is a receiving or results cabinet, not the source POD cabinet.
2. The cabinet is line-oriented, not table-oriented, because the export contains line-level business fields but no DocuWare table field definition.
3. The application should treat this cabinet as a sync target or imported operational feed made up of flat records.
4. The application still needs the POD cabinet definition separately to model where the binary POD documents live and how the initial import starts.
5. The cabinet also exists as a client BI and reporting source, so its current shape should be treated as an external contract.

The separate `Documents` export has now confirmed the upstream POD cabinet and its `PRODUCT_TABLE` field. Based on user confirmation, the `Documents` to `Receiving Data` transformation should remain untouched and the application should integrate at `Receiving Data`, not upstream of it.

## Structural Implications

The current export does not describe a header record with an embedded table. It describes a flat document shape with these characteristics:

- header-like identifiers repeated on each record
- line-level fields such as line number, item code, quantity, and quantity received
- receiving outcome fields such as status and discrepancy
- many defect and mitigation flags on the same record

That strongly suggests one DocuWare record per receiving line, or at minimum one flat record per imported item, rather than one receipt document with a native DocuWare table field.

## High-Confidence App Mapping

### Receipt Header Or Grouping Fields

- `DELIVERY_NOTE` -> `receipts.delivery_note_number`
- `ORDER_NUMBER` -> `receipts.purchase_order_number`
- `WEIGHBRIDGE_TICKET_NUMBER` -> new receipt field
- `VEHICLE_REGISTRATION` -> new receipt field
- `JOB_NUMBER` -> new receipt field
- `COMPANY` -> likely customer or supplier grouping field, business confirmation required
- `FABRICATOR` -> likely supplier or fabricator field, business confirmation required
- `DNDOCID` -> external DocuWare grouping reference
- `DNDOCIDI` -> external numeric DocuWare grouping reference

### Receipt Line Fields

- `LINE` -> `receipt_lines.line_number` after parsing
- `ITEM_CODE_ON_DELIVERY_NOTE` -> `receipt_lines.item_code`
- `ITEM_NAME_ON_DELIVERY_NOTE` -> line description candidate
- `MATERIAL_CODE` -> alternate item code candidate
- `MATERIAL_DESCRIPTION` -> line description candidate
- `INTERNAL_DESCRIPTION` -> line condition or internal note candidate
- `QUANTITY` -> `receipt_lines.expected_quantity`
- `QUANTITY_RECEIVED` -> `receipt_lines.received_quantity`
- `PROCESS` -> new line field or line metadata
- `PACKAGING_METHOD` -> new line field or line metadata
- `STORED_IN` -> new line field or line metadata
- `BAY` -> new line field or line metadata
- `ACCESSORIES` -> new line field or line metadata
- `WEIGHT` -> new line field
- `UNIQUE_NUMBER` -> external line reference
- `PRIMARY_KEY` -> external line or record reference

### Receiving Outcome Fields

- `RECEIVING_STATUS` -> sync status or externally visible line status
- `DISCREPANCY` -> line exception summary candidate
- `QUANTITY_DISCREPANCY` -> quantity mismatch detail
- `COMMENTS` -> line or receipt notes
- `ADDITIONAL_COMMENTS` -> line or receipt notes
- `OTHER` -> freeform exception detail

### Defect And Quality Flags

The following fields should not be modelled as one database column each in the first pass. They should be normalized into checklist or exception records, while the raw DocuWare values are preserved in a source snapshot:

- `DEFECT_DETECTED`
- `PAINT`
- `DAMAGED`
- `BURR`
- `PIN_HOLES`
- `WELD_SPLATTER`
- `WELDING_FLUX`
- `CONTINUOUS_WELD`
- `ARTICLE_OVERLAPPED`
- `POSSIBLE_DISTORTION`
- `THREADED_ARTICLE`
- `RUST`
- `DELAMINATION`
- `NON_CONFORMING_PRE_GALV`
- `ENCLOSED_CAVITY`
- `HOLES_INADEQUATE`
- `NO_HANGING_METHOD`

### Mitigation Fields

These are best represented as structured exception details or checklist follow-up values:

- `PAINT_MITIGATION`
- `DAMAGE_MITIGATION`
- `RUST_MITIGATION`
- `DELAMINATION_MITIGATION`
- `NON_CONFORMING_PRE_GALV_MITIG`
- `THREADED_ARTICLE_MITIGATION`
- `ENCLOSED_CAVITY_HOLES_REQUIRE`

### Technical Or System Fields To Persist

- `DWDOCID` -> DocuWare record id for sync target; should live on `receipt_lines`
- `DNDOCID` -> external source or grouping id
- `DNDOCIDI` -> numeric variant of external source or grouping id
- `PRIMARY_KEY` -> keep as external traceability key
- `UNIQUE_NUMBER` -> keep as external traceability key
- `DWSTOREDATETIME` -> external stored timestamp if needed for reconciliation
- `DWMODDATETIME` -> external modified timestamp if needed for reconciliation

## Verified Field Inventory

### Header And Grouping

- `WEIGHBRIDGE_TICKET_NUMBER`
- `DELIVERY_NOTE`
- `ORDER_NUMBER`
- `JOB_NUMBER`
- `VEHICLE_REGISTRATION`
- `COMPANY`
- `FABRICATOR`
- `DNDOCID`
- `DNDOCIDI`
- `PRIMARY_KEY`

### Line Identity And Description

- `LINE`
- `UNIQUE_NUMBER`
- `ITEM_CODE_ON_DELIVERY_NOTE`
- `ITEM_NAME_ON_DELIVERY_NOTE`
- `ITEM_TYPE`
- `MATERIAL_CODE`
- `MATERIAL_MARKINGS`
- `MATERIAL_SIZE`
- `MATERIAL_THICKNESS`
- `MATERIAL_LENGTH`
- `MATERIAL_DESCRIPTION`
- `INTERNAL_DESCRIPTION`
- `PROCESS`
- `WEIGHT`

### Quantity And Location

- `QUANTITY`
- `QUANTITY_RECEIVED`
- `DISCREPANCY`
- `QUANTITY_DISCREPANCY`
- `STORED_IN`
- `BAY`
- `PACKAGING_METHOD`
- `ACCESSORIES`
- `RECEIVING_STATUS`

### Quality, Defects, And Checks

- `REQUIRED_GALV_THICKNESS`
- `DRAIN_HOLES`
- `VENT_HOLES`
- `JIG_HOLES`
- `CAVITY_VENT_HOLES`
- `LIFTING_LUG_NUT`
- `HANG_NOTCH`
- `ARTICLE_OVERLAP_VENT_HOLES`
- `VENT_HOLES_REQUIRED`
- `DRAIN_HOLES_REQUIRED`
- `JIG_HOLE_REQUIRED`
- `PAINT`
- `THREADED_ARTICLE`
- `DAMAGED`
- `BURR`
- `PIN_HOLES`
- `WELD_SPLATTER`
- `WELDING_FLUX`
- `CONTINUOUS_WELD`
- `ARTICLE_OVERLAPPED`
- `POSSIBLE_DISTORTION`
- `DEFECT_DETECTED`
- `OIL_GREASE_DIESEL`
- `SHARP_EDGES`
- `RUST`
- `DELAMINATION`
- `NON_CONFORMING_PRE_GALV`
- `ENCLOSED_CAVITY`
- `HOLES_INADEQUATE`
- `NO_HANGING_METHOD`

### Mitigations And Follow-Up

- `PAINT_MITIGATION`
- `DAMAGE_MITIGATION`
- `RUST_MITIGATION`
- `DELAMINATION_MITIGATION`
- `NON_CONFORMING_PRE_GALV_MITIG`
- `THREADED_ARTICLE_MITIGATION`
- `ENCLOSED_CAVITY_HOLES_REQUIRE`
- `ENCLOSED_CAVITY_HOLES_QUANTIT`
- `NO_HANGING_LIFTING_LUG_NUT_RE`
- `NO_HANGING_HANG_NOTCH_REQUIRE`
- `NO_HANGING_LIFTING_LUG_NUT_R1`
- `NO_HANGING_HANG_NOTCH_REQUIR1`

### Freeform Text

- `COMMENTS`
- `ADDITIONAL_COMMENTS`
- `OTHER`
- `TEXTSHOT`

## Recommended Database Changes

Do not add all `79` business fields as first-class relational columns.

Instead:

1. Normalize only the workflow-critical fields already needed by the app.
2. Persist the full imported DocuWare row snapshot as JSON for traceability and future mapping.
3. Store the external DocuWare record id on each receipt line, not just on the header, because this cabinet appears line-oriented.

### Minimum Additions

- `receipts.source_docuware_document_id`
- `receipts.source_docuware_cabinet_id`
- `receipts.imported_at`
- `receipts.last_synced_at`
- `receipts.sync_status`
- `receipts.docuware_group_reference`
- `receipt_lines.docuware_record_id`
- `receipt_lines.docuware_unique_number`
- `receipt_lines.docuware_primary_key`
- `receipt_lines.docuware_source_payload JSONB`
- optional `receipts.docuware_source_payload JSONB` for header-level grouping context

## Import Contract Implication

Because the existing DocuWare flow from `Documents` to `Receiving Data` should remain untouched, the import process should:

1. read one DocuWare flat record at a time
2. group records into an application receipt using business keys such as `DELIVERY_NOTE`, `ORDER_NUMBER`, and confirmed grouping ids
3. create one `receipt_lines` row per DocuWare record
4. persist raw DocuWare payload alongside normalized fields

## Sync-Back Implication

For this cabinet alone, the sync process should:

1. update the external DocuWare line record using `receipt_lines.docuware_record_id`
2. write line-level outcome values like `QUANTITY_RECEIVED`, `RECEIVING_STATUS`, `DISCREPANCY`, and approved defect summaries
3. avoid treating the cabinet as a native table field target because none is defined in the export

Because this cabinet is also consumed for BI outside the scope of this project, the application should preserve compatibility with its existing field model and avoid assuming it can simplify or repurpose the cabinet structure.

## Upstream Reference

The upstream POD cabinet is now documented in `docs/docuware-documents-cabinet.md`.

That cabinet matters for provenance and traceability, but it is not the first application integration point if the existing DocuWare materialization into `Receiving Data` stays as-is.