# Receiving App — Enhancement Backlog

A consolidated list of candidate enhancements to take the receiving app to best-in-class. Grouped by tier / theme. Not yet prioritised into a roadmap.

## Tier 1 — highest impact

1. Plate-number OCR scan to identify load on arrival
2. DN barcode/QR scan as alternate identification
3. Unplanned arrival / **"Create New POD"** flow — **port from existing PlanetPress solution**, reference source in [newPOD.txt](newPOD.txt). Must exist in the new app at parity before cutover.

   **Behaviour observed in current implementation:**
   - Role-gated to `Admin` or `POD Creator`
   - Optional `?wbt=` query param pre-fills the weighbridge ticket (entry from a scan/lookup)
   - Header fields (all required unless noted): Delivery Note Number, Order Number, Vehicle Registration, Delivery Date (defaults to today), Weighbridge Ticket Number, Company, Fabricator (optional)
   - Multi-row line-item table with: Weighbridge Ticket (auto-synced from header, readonly), Delivery Note (auto-synced from header), Item Code, Item Description, Item Size, Item Quantity (>0), Weight, Material Markings, Material Length, Job Number, Other
   - Add Item Row / Remove Item Row (min 1 row enforced)
   - Additional Details section: Job Comments, Product Name, Processing Status (`pending` / `in_progress` / `completed`), Stored By (defaults to logged-in user), Completion Date (required when status = `completed`, must be ≥ delivery date)
   - Validation: alphanumeric+hyphen on Delivery Note / Order / Weighbridge fields; delivery date cannot be in the future; quantity must be positive
   - Unsaved-changes confirmation on Cancel
   - Submit double-click guard (button disabled during in-flight request)
   - 30s loader timeout safety net
   - **Submit endpoint:** `POST {address}/newPODSubmit` with JSON payload shape:
     ```json
     {
       "DELIVERY_NOTE_NUMBER": "...", "ORDER_NUMBER": "...",
       "VEHICLE_REGISTRATION_": "...", "DATE": "YYYY-MM-DD",
       "WEIGHBRIDGE_TICKET_NUMBER": "...", "COMPANY": "...",
       "FABRICATOR": "...",
       "PRODUCT_TABLE": { "Row": [ { "WEIGHBRIDGE_TICKET_NUMBER": "...", "DELIVERY_NOTE": "...", "ITEM_CODE": "...", "ITEM_DESCRIPTION": "...", "ITEM_SIZE": "...", "ITEM_QUANTITY": "...", "WEIGHT": "...", "MATERIAL_MARKINGS": "...", "MATERIAL_LENGTH": "...", "JOB_NUMBER": "...", "OTHER": "..." } ] },
       "JOB_COMMENTS": "...", "STORED_BY": "...",
       "COMPLETION_DATE": "...", "PRODUCT_NAME": "...",
       "PROCESSING_STATUS": "pending|in_progress|completed",
       "DOCUMENTTYPE": "Delivery Note"
     }
     ```
   - Success criteria: response `DWStatus.status === 200`, then redirect to `/pods`

   **Porting notes for the new app:**
   - Same payload shape so the DocuWare push endpoint stays compatible (or wrap the legacy endpoint behind a thin adapter)
   - Keep field-level parity at minimum; opportunity to align field names with the rest of the new app's schema (e.g., drop the trailing underscore on `VEHICLE_REGISTRATION_`)
   - Reuse the existing `sync_status` / outbound-queue worker so a created-while-offline POD queues and pushes when reconnected (true offline-first, Tier 1 #7)
   - Replace role string check with the new app's RBAC; `POD Creator` role must exist
   - Capture the same auto-sync behaviour (header weighbridge/delivery-note → all rows) so the operator never types the same value twice
   - Pre-fill from `?wbt=` should generalise to other entry points (scan-from-gate, ANPR feed when #50 lands)
4. Mandatory defect photos (auto-triggered when defect ≠ none)
5. Load arrival photo (truck + plate)
6. Per-line "as received" photo for high-value items
7. True offline-first: service worker + IndexedDB queue
8. Per-line sync state visible in UI (synced / queued / failed)
9. Retry with exponential backoff + server-side conflict resolution
10. "Pending sync" badge in topbar with tap-to-see-queue
11. Bluetooth sticker printing (Zebra/Brother) post-GRN with item code, process, customer, GRN#, QR

## Tier 2 — UX upgrades

12. Voice / hands-free line capture
13. Two-receiver mode with "claim line" and "second-checked by"
14. Discrepancy resolution flow when two receivers' counts disagree
15. Smart defaults from customer history (pre-select last-used process, packaging, etc.)
16. Auto-fill vehicle reg for regular drivers
17. Discrepancy reason capture (left at supplier / damaged / not loaded / unverifiable)
18. Auto-email supplier + buyer with photos on discrepancy
19. Lock GRN until QC sign-off for high-severity defects
20. Live load timer + demurrage SLA display
21. "Trucks waiting" surface on home tab
22. **Accountable one-tap receive** — scan-and-confirm walkthrough with one-tap "Confirm as expected" for the 90% case. Credibility comes from named accountability rather than per-line attestation: every receipt carries `RECEIVED_BY` (auto-populated from the authenticated user, immutable after submit, pushed to the DocuWare `RECEIVED_BY` index field on both Receiving Data line updates and the GRN cabinet doc). Pairs with #23 (defects as exception path), #47 (personal accuracy stats — makes accountability felt, not just logged), and eventually #41 (tamper-evident audit log — makes the signature defensible months later in a dispute).
23. Defects/discrepancy as exception path, not default step
    - **Calibration gap (open):** named-receiver accountability assumes the signature carries weight. New hires, high-value loads, and unfamiliar suppliers may need a fallback (random-line audit, supervisor co-sign threshold, or risk-weighted per-line confirm) before one-tap is granted unconditionally.

## Tier 3 — operational polish

24. Supervisor live view (yard state, who's receiving what, idle operators, flagged loads)
25. Gate guard truck dispatch board (expected today + arrival ticks)
26. PPE / safety check on first login of shift
27. Full rejection workflow (no-offload, email customer, photo truck leaving, NCR generation)
28. End-of-shift handover summary to supervisor
29. Localization (Afrikaans, Zulu)
30. History search ("Eskom, last week, rust defects")
31. Ambient-light-triggered high-contrast outdoor mode
32. Chunky outdoor typography

## Tier 4 — strategic differentiators

33. Customer self-service portal (POD scan, GRN, defect photos, bath ETA)
34. Predictive QC flagging from defect history
35. Bath load-planning handoff (weight/length feeds jig planner)
36. ML photo defect classifier (auto-suggest category from photo)

## Operational reality

37. Weight reconciliation (weighbridge ticket vs theoretical line weight, variance triggers re-count)
38. Customer-specific item code aliases (search by customer's code or yours)
39. Length verification for tube/section with reference-stick photo
40. Forced process confirm step (pickling vs galv vs duplex routing)

## Trust & dispute resolution

41. Tamper-evident hash-chained audit log (operator, timestamp, GPS, device)
42. Sealed-load workflow (intact seal photo, broken-seal exception path)
43. Two-person sign-off for high-value loads (supervisor PIN at GRN issue)

## Data quality / DocuWare hygiene

44. Reverse-validation lint before GRN issue (missing customer code, ambiguous process, expired pricing)
45. Duplicate POD/DN hard-block

## Receiver wellbeing

46. Shift fatigue indicator (suggest handoff after 6h continuous)
47. Personal accuracy stats vs yard average

## Integration depth

48. ERP GRN posting (Sage/SAP), not just DocuWare
49. Carrier EDI / ASN ingestion to pre-populate expected loads
50. Fixed ANPR camera at gate writing plate + arrival into queue

## Closed-loop reconciliation

51. Post-galv bundle scan-back (received → processed → dispatched count reconciliation)

---

## Suggested first slice

If scoping a single sprint: **plate scan + barcode (#1, #2) + one-tap "as expected" walkthrough (#22) + mandatory defect photo on flag (#4)**. Fast for the 90% case, evidence trail for the 10% exception.

Honourable mention to add to that slice: **weight reconciliation (#37)** — single highest-leverage objective check in a steel yard, data already lives on the weighbridge ticket.
