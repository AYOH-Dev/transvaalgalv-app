# Deployment Baseline

## Expected Target

- Repository: `AYOH-Dev/transvaalgalv-app`
- Target host path: `/opt/projects/transvaalgalv-app`
- Public host: `transvaal.ayai.live`
- Database: `transvaalgalv_app_db`
- Development database: `transvaalgalv_app_db_dev`
- Database host: `10.100.0.1:5432`

## Deployment Notes

1. Provision the PostgreSQL database before application startup.
2. Use a dedicated role for the application and keep `sslmode=require` in the runtime connection string.
3. Keep secrets out of version control.
4. Run schema migrations before switching traffic.
5. Only expose operational health endpoints without authentication.
6. Add the public reverse-proxy configuration after the authenticated app routes are implemented.
7. The current `10.100.0.1:5432` endpoint refuses TLS, so runtime startup is blocked until PostgreSQL TLS is enabled or a TLS-capable proxy is introduced.