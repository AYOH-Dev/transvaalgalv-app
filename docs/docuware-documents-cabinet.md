# DocuWare Documents Cabinet

## Verified Export

- Export file: `docs/Documents 4_17_2026 2_06_24 PM.xml`
- Cabinet name: `Documents`
- Cabinet id: `38`
- Total fields: `81`
- Custom writable business fields: `49`
- System fields: `32`
- Table fields: `1`

## What This Cabinet Is

This is the upstream POD or document cabinet.

It contains:

- document-level metadata
- operational header fields such as delivery note, order number, fabricator, and weighbridge information
- the original DocuWare document identity
- a real DocuWare table field named `PRODUCT_TABLE`

## Product Table

The `PRODUCT_TABLE` field is a true DocuWare table field. Its columns are:

- `PRODU_ITEM_CODE` -> Item Code
- `PRODU_ITEM_DESCRIPTION` -> Item Description
- `PRODU_ITEM_SIZE` -> Item Size
- `PRODU_ITEM_QUANTITY` -> Item Quantity
- `PRODU_OTHER` -> Other
- `PRODU_JOB_NUMBER` -> Job Number
- `PRODU_WEIGHBRIDGE_TICKET_NUMB` -> Weighbridge Ticket Number
- `PRODU_DELIVERY_NOTE` -> Delivery Note
- `PRODU_MATERIAL_MARKINGS` -> Material Markings
- `PRODU_MATERIAL_LENGTH` -> Material Length
- `PRODU_STATUS` -> Status
- `PRODU_UNIQUE_NUMBER` -> Unique Number
- `PRODU_WEIGHT` -> Weight

## Important Boundary Decision

The user confirmed that the current DocuWare creation of `Receiving Data` records from the `Documents` cabinet is already correct and should not be changed.

That means the application should not replace or reimplement:

- document ingestion into `Documents`
- table extraction from `PRODUCT_TABLE`
- DocuWare-side creation of `Receiving Data` records

Instead, the application should treat `Documents` as upstream provenance and `Receiving Data` as the operational integration boundary.

## App Impact

The application may still store `Documents` references when available for traceability, but it does not need to import directly from this cabinet in the first implementation.

The first implementation should:

1. read already-created records from `Receiving Data`
2. group and normalize them into application receipts and receipt lines
3. keep DocuWare record ids needed for sync-back
4. optionally retain `Documents` cabinet references when the receiving record exposes them or when a later lookup is needed

## High-Value Header Fields

- `DWDOCID` -> source document id
- `DOCUMENTNO` -> document number
- `DOCUMENTTYPE` and `DOCUMENT_TYPE` -> document classification candidates
- `DELIVERY_NOTE_NUMBER` -> delivery note
- `WEIGHBRIDGE_TICKET_NUMBER` -> weighbridge ticket
- `ORDER_NUMBER` -> order number
- `JOB_NUMBER` -> job number
- `FABRICATOR` -> fabricator
- `COMPANY` -> company
- `VEHICLE_REGISTRATION_` -> vehicle registration
- `TOTAL_WEIGHT` -> total weight
- `WEIGHBRIDGE_NETT_WEIGHT` -> nett weight

## Why This Still Matters

Even though the app should not integrate directly with `Documents` first, this export is still useful because it proves:

- the original POD cabinet exists separately from `Receiving Data`
- line extraction originates from a true table field rather than a flat document
- the current DocuWare pipeline already performs the table-to-flat transformation the app would otherwise have needed to build