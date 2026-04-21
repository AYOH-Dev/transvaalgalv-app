Add Caddy include for transvaal.ayai.live

1. Copy the include into the host Caddy config directory (on the server):

   sudo mkdir -p /etc/caddy/sites
   sudo cp deploy/caddy/transvaal.caddy /etc/caddy/sites/transvaal.caddy

2. Edit `/etc/caddy/Caddyfile` and add the import line (near other `import sites/*` entries):

   import sites/transvaal.caddy

3. Validate and reload Caddy:

   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo caddy reload --config /etc/caddy/Caddyfile

4. Verify the endpoint from the DocuWare host or from this host:

   curl -v https://transvaal.ayai.live/integrations/docuware/imports

Notes:
- This include proxies first to port 8083, then 8080 as a fallback; adjust ports if your app listens elsewhere.
- If your Transvaal app is a systemd service or container, ensure it is running and listening on the expected port before reloading Caddy.
