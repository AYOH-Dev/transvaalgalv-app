# Integrations

## DocuWare

DocuWare is used for document archive and retrieval, not for day-to-day receipt processing state.

## Integration Rules

1. Receipt processing state must stay in the application database.
2. Files should be staged locally or in object storage before archive sync when retry behavior is required.
3. Archive status should be visible from the application database.
4. Failures to push to DocuWare must not destroy the operational receipt record.

## Initial Data We Expect To Map

- Receipt number
- Supplier reference
- Purchase order number
- Delivery note number
- Document type
- Archive upload status
- DocuWare document identifier

## Configuration

The initial environment variables for the archive layer are defined in `.env.example`:

- `DOCUWARE_BASE_URL`
- `DOCUWARE_FILE_CABINET_ID`
- `DOCUWARE_USERNAME`
- `DOCUWARE_PASSWORD`