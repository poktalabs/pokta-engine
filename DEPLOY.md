# Deploy godin-engine v0.1 to Railway

The engine ships as **two Railway services off this one repo** plus a **Postgres**:

| Service | Config file | Domain | Role |
|---|---|---|---|
| `engine-api` | `railway.api.json` | public | Hono control plane; runs the migration on deploy |
| `worker` | `railway.worker.json` | none | pg-boss consumer; runs jobs |
| `Postgres` | (Railway plugin) | private | the engine's own DB (D-1) |

Both app services build with Nixpacks (`pnpm install` at the workspace root), then
start only their app via `pnpm --filter …`.

## One-time setup (Railway dashboard)

1. **New Project → Deploy from GitHub repo →** `poktalabs/pokta-engine`.
   This creates the first service. Rename it **`engine-api`**.
2. **Add Postgres:** in the project, **New → Database → PostgreSQL**. It exposes
   `DATABASE_URL` on the Postgres service.
3. **Configure `engine-api`:**
   - **Settings → Build → Config-as-code path:** `railway.api.json`
   - **Variables:**
     - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`  ← reference, uses the private network (no SSL needed)
     - `SERVICE_KEYS` = `godinez-studio:<strong-key>,landing-godinez:<strong-key>`
       **Do not leave this empty in production** — empty = DEV mode = open to anyone.
   - **Settings → Networking → Generate Domain** (this is your public URL).
4. **Add the worker service:** **New → GitHub Repo →** same `poktalabs/pokta-engine`.
   Rename it **`worker`**.
   - **Config-as-code path:** `railway.worker.json`
   - **Variables:** `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (no domain, no SERVICE_KEYS)
5. **Deploy.** On the `engine-api` deploy, `preDeployCommand` runs
   `drizzle-kit migrate` against the Postgres, creating the three tables before the
   server starts. The worker just boots and starts polling.

> If you ever point a service at the **public** Postgres URL instead of the
> `${{Postgres.DATABASE_URL}}` reference, append `?sslmode=require`.

## Verify the live engine

```bash
HOST=https://<your-engine-api-domain>
KEY=<one of the SERVICE_KEYS values>

curl -s $HOST/                       # {"service":"godin-engine engine-api",...,"ok":true}

# quota workflow
curl -s $HOST/v1/workflows/echo/runs -H "X-Service-Key: $KEY" \
  -H 'content-type: application/json' \
  -d '{"consumer_id":"godinez-studio","input":{"message":"hello from prod"}}'

# approval workflow
curl -s $HOST/v1/workflows/echo-draft/runs -H "X-Service-Key: $KEY" \
  -H 'content-type: application/json' \
  -d '{"consumer_id":"poktacare","input":{"topic":"care plan"}}'
curl -s "$HOST/v1/approvals?state=pending" -H "X-Service-Key: $KEY"
curl -s $HOST/v1/approvals/<approvalId>/approve -H "X-Service-Key: $KEY" \
  -H 'content-type: application/json' -d '{"decided_by":"dr.alice"}'
```

## CLI alternative (optional)

```bash
brew install railway        # or npm i -g @railway/cli
railway login
railway link                # select the project
railway up                  # deploy current dir
```
You still set the config-as-code path + variables per service in the dashboard.

## Before real traffic (not blocking the toy)

- Set `SERVICE_KEYS` (never deploy DEV mode publicly).
- Scope each key to its `consumer_id` (today any valid key can post as any consumer).
- Close the known gaps in `README.md` (transactional enqueue + reaper, real
  sandbox/agent runtimes).
