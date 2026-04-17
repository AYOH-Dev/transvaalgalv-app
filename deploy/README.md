# Deployment Baseline

## Expected Target

- Repository: `AYOH-Dev/transvaalgalv-app`
- Target host path: `/opt/projects/transvaalgalv-app`
- Public host: `transvaal.ayai.live`
- Database: `transvaalgalv_app_db`

## Deployment Notes

1. Provision the PostgreSQL database before application startup.
2. Keep secrets out of version control.
3. Run schema migrations before switching traffic.
4. Only expose operational health endpoints without authentication.
5. Add the public reverse-proxy configuration after the authenticated app routes are implemented.