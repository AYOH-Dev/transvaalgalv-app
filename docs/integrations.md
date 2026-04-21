# Integrations

## DocuWare

DocuWare is used to capture the POD, apply intelligent indexing, and hold the external `Records` representation that the receiving workflow syncs back to. It is not the store for live receipt processing state.

The currently verified exports show two separate cabinets:

- `Documents`: the upstream POD cabinet with a true `PRODUCT_TABLE`
- `Receiving Data`: the flat, line-oriented receiving/results cabinet

The user confirmed that the existing DocuWare creation of `Receiving Data` from `Documents` should remain untouched. The application boundary is therefore `consume Receiving Data`, not `replace Documents-to-Receiving-Data transformation`.

The `Receiving Data` cabinet also serves client BI and reporting access outside the scope of this project, which is another reason to preserve that existing DocuWare-side contract.

## Integration Rules

1. Header and line-item expectations can be sourced from DocuWare, but live receipt progress must stay in the application database.
2. The application must store DocuWare identifiers needed to re-sync status back to the correct document and line records.
3. Files should be staged locally or in object storage before archive sync when retry behavior is required.
4. Archive and sync status should be visible from the application database.
5. Failures to push to DocuWare must not destroy the operational receipt record.

## Initial Data We Expect To Map

- Receipt grouping identifiers from `Receiving Data`
- Purchase order number
- Delivery note number
- Weighbridge ticket number
- Receiving line identifiers
- Receiving line quantities and outcomes
- DocuWare receiving record identifier for sync-back
- Upstream `Documents` identifiers when needed for traceability

## Ownership Model

- DocuWare owns: POD binary, `Documents` header fields, `PRODUCT_TABLE` extraction, and creation of downstream `Receiving Data` records.
- The application database owns: authenticated users, expected operational receipt snapshot, live receipting state, defects, review actions, and sync retry state.
- The application writes selected status and outcome fields back to DocuWare so users can continue to see receipt progress there.
- External BI consumers may also read from `Receiving Data`, so application integration must remain compatible with that cabinet's current semantics.

## Workflow Reference

See `docs/receiving-workflow.md` for the target flow that replaces the current Planet Press handoff.

See `docs/docuware-receiving-data-cabinet.md` for the verified field inventory and the current gap around the POD source cabinet.

See `docs/docuware-documents-cabinet.md` for the verified POD/source cabinet and table field definition.

## Configuration

The initial environment variables for the archive layer are defined in `.env.example`:

- `DOCUWARE_BASE_URL`
- `DOCUWARE_FILE_CABINET_ID`
- `DOCUWARE_USERNAME`
- `DOCUWARE_PASSWORD`
- `DOCUWARE_PUSH_USERNAME`
- `DOCUWARE_PUSH_PASSWORD`

The inbound push endpoint `POST /integrations/docuware/imports` requires dedicated Basic auth credentials from DocuWare using `DOCUWARE_PUSH_USERNAME` and `DOCUWARE_PUSH_PASSWORD`.

See `docs/docuware-web-service-connection.md` for the actual DocuWare web service body shape, inferred field behavior, and a ready-to-use Receiving Data payload template.