# DocuWare Web Service Connection

## Endpoint

- URL: `https://transvaal.ayai.live/integrations/docuware/imports`
- Method: `POST`
- Authentication: `Basic`
- Content-Type: `application/json`

This route now accepts the native flat JSON body that DocuWare web service connections emit from the `Receiving Data` cabinet. The older wrapped `rows` contract is still supported for scripts and manual testing, but DocuWare itself does not need that wrapper anymore.

## Native Payload Contract

DocuWare can post a single Receiving Data row directly as JSON.

The exact placeholder template is in `docs/docuware-receiving-data-native-payload.json`.

At minimum, the import route needs:

- `DWDOCID` so the row has a stable record identifier
- enough grouping fields to build a receipt key, usually `DNDOCID` plus the delivery or order identifiers that already exist in the cabinet

## What The API Infers

When DocuWare posts the native flat body, the API derives the wrapped import metadata automatically:

- `record_id` from `DWDOCID`
- `source_document_id` from `DNDOCID`, then `DNDOCIDI`, then `DWDOCID`
- `source_cabinet_id` from `DWSYS_FC_GUID`, otherwise from configured `DOCUWARE_FILE_CABINET_ID`

That means DocuWare does not need to send this shape:

```json
{
  "source_cabinet_id": "198",
  "source_document_id": "doc-38-100",
  "rows": [
    {
      "record_id": "49831",
      "payload": {
        "DWDOCID": "49831"
      }
    }
  ]
}
```

It can send the row payload directly.

## Receipt Grouping

The importer groups rows into one application receipt using these Receiving Data fields, in this order:

- `DNDOCID`
- `DNDOCIDI`
- `DELIVERY_NOTE`
- `DELIVERY_NOTE_NUMBER`
- `ORDER_NUMBER`
- `WEIGHBRIDGE_TICKET_NUMBER`
- `JOB_NUMBER`
- `COMPANY`
- `FABRICATOR`

If DocuWare sends one row per call, repeated calls with the same grouping values will be merged into the same receipt while that receipt is still in draft state.

## Current Normalized Fields

The importer currently normalizes these fields first:

- header: `DELIVERY_NOTE`, `ORDER_NUMBER`, `WEIGHBRIDGE_TICKET_NUMBER`, `JOB_NUMBER`, `COMPANY`, `FABRICATOR`, `DNDOCID`, `DNDOCIDI`
- line: `LINE`, `ITEM_CODE_ON_DELIVERY_NOTE`, `ITEM_NAME_ON_DELIVERY_NOTE`, `MATERIAL_CODE`, `MATERIAL_DESCRIPTION`, `INTERNAL_DESCRIPTION`, `QUANTITY`, `QUANTITY_RECEIVED`, `ITEM_TYPE`, `COMMENTS`, `ADDITIONAL_COMMENTS`, `DISCREPANCY`, `OTHER`, `UNIQUE_NUMBER`, `PRIMARY_KEY`, `DWDOCID`

All other fields are still preserved in the raw line payload JSON for traceability and later mapping.

## Recommended DocuWare Connection Setup

- Use the `Receiving Data` cabinet as the source.
- Post one row per event unless your DocuWare configuration can reliably batch multiple rows.
- Keep the body as raw JSON with DocuWare placeholders.
- Use the Basic auth machine credentials configured for the environment.

## Manual Test Example

This remains valid for curl or Postman:

```json
{
  "DWDOCID": "49831",
  "DNDOCID": "doc-38-100",
  "DWSYS_FC_GUID": "51b2227c-4d38-4e2e-a583-f5a012b75496",
  "DELIVERY_NOTE": "DN-123",
  "ORDER_NUMBER": "PO-1",
  "LINE": "1",
  "ITEM_CODE_ON_DELIVERY_NOTE": "ITEM-1",
  "ITEM_NAME_ON_DELIVERY_NOTE": "Item One",
  "QUANTITY": "10",
  "QUANTITY_RECEIVED": "4"
}
```