Transvaal Caddy include

Purpose
- Caddy site include for `transvaal.ayai.live` and `transvaalgalv.ayai.live`.

Best practices applied
- Proxy API paths only to the dedicated backend on `10.100.0.1:8083` to avoid gateway interference.
- Apply modern security headers (HSTS, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, Permissions-Policy).
- Do not set redundant `header_up` values for `X-Forwarded-For`/`X-Forwarded-Proto` — Caddy passes these by default and will warn.
- Keep host-specific site blocks (or includes) with precise `handle` matchers to avoid unintended routing by other site blocks.

Installation

1. Copy the include to the system sites directory:

```bash
sudo cp deploy/caddy/transvaal.caddy /etc/caddy/sites/transvaal.caddy
```

2. Validate and reload Caddy:

```bash
sudo /usr/bin/caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Verification
- Check the readiness endpoint:

```bash
curl -sS -w "\nHTTP_CODE:%{http_code}\n" https://transvaalgalv.ayai.live/ready
```

- Test auth login (use a real admin):

```bash
curl -v -i -X POST https://transvaalgalv.ayai.live/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"real-admin@transvaal.local","password":"<password>"}'
```

Notes
- Keep the include focused on the site hostnames and API paths to prevent other gateway blocks from capturing requests.
- Prefer a single upstream (8083) for this app; only add fallbacks after deliberate testing.
- If Caddy logs warnings about `header_up`, remove redundant headers — Caddy sets forwarded headers automatically.
