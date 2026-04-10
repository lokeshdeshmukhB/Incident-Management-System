# AIMS - Automated Incident Management System

AI-powered multi-agent platform that automates the full incident lifecycle:
**Detection -> Alert -> Decision -> Action -> Resolution -> Reporting**

## Architecture

- **Backend**: Node.js + Express with 6 AI agents powered by Groq
- **Database**: Supabase (PostgreSQL) with real-time subscriptions
- **Frontend**: React 18 + Vite + TailwindCSS + Recharts
- **Real-time**: Socket.io for live incident updates
- **AI Agents (Python)**: LangChain + LangGraph; Node invokes agents via `python -m incident_management.bridge` (see `incident_management/`)

## Quick Start

### 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the migration:

```sql
-- Copy and paste the contents of data/migration.sql
```

### 2. Configure Environment

```bash
cp .env.example .env
# Fill in:
# - SUPABASE_URL and SUPABASE_ANON_KEY (from Supabase project settings)
# - GROQ_API_KEY_1 (minimum 1 key, up to 3 for load distribution)
```

### 3. Install Dependencies

```bash
# Python agents (required for the incident pipeline)
python -m pip install -r incident_management/requirements.txt

# Node + frontend
cd server && npm install
cd ../client && npm install
```

### 4. Seed Sample Data

```bash
cd server && node seed.js
```

### 5. Start the Application

**Recommended:** from the repo root run **`npm run dev`** — it starts the API first, waits until `.aims-backend-port` is written (actual listen port), then starts Vite so `/api` proxy and Socket.io stay in sync even when port 5000 is busy.

Optional overrides: `client/.env.development` with `VITE_DEV_API_TARGET` (wins over the port file), or copy `client/.env.development.example`.

```bash
# One command (repo root — install root deps once: npm install)
npm run dev

# Or two terminals
cd server && npm run dev
cd client && npm run dev   # restart after API is listening so Vite picks up .aims-backend-port
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000
- Health check: http://localhost:5000/api/health

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/alerts | Ingest new alert (triggers full pipeline) |
| GET | /api/alerts | List all alerts |
| GET | /api/incidents | List incidents (filter by status/severity/service) |
| GET | /api/incidents/:id | Get incident detail with agent outputs |
| PATCH | /api/incidents/:id | Manual status override |
| GET | /api/reports/:incident_id | Get AI-generated report |
| POST | /api/reports/:incident_id/regenerate | Regenerate report |
| GET | /api/dashboard/kpis | MTTD, MTTR, automation rate |
| GET | /api/dashboard/timeline | Incidents over time |
| GET | /api/workflows | List workflow rules |
| POST | /api/workflows | Create workflow rule |

## Pipeline Flow

```
Raw Alert -> Detection Agent (classify, enrich, deduplicate)
          -> Decision Agent (match rules, safety checks)
          -> Action Agent (generate commands, execute)
          -> Resolution Agent (health check, retry/escalate)
          -> Reporting Agent (RCA, timeline, recommendations)
```

Each agent uses Groq AI with structured JSON output. Three API keys are distributed across agents to avoid rate limits.

## Project Structure

```
aims/
  incident_management/  - Python agents, LangGraph graph, bridge (Groq via LangChain)
  server/
    config/       - Supabase, environment config
    engine/       - Orchestration pipeline, workflow engine, safety guards
    models/       - Supabase data access layer
    routes/       - Express API routes
    services/     - CSV parser, action executor, notifier, logger
    sockets/      - Socket.io event handlers
    jobs/         - CSV alert polling
  client/
    src/
      components/ - Dashboard, Incidents, Reports UI components
      hooks/      - useSocket, useIncidents (React Query)
      store/      - Zustand state management
      pages/      - Dashboard, Incidents, Reports, Escalation pages
  data/
    alerts.csv    - Sample alert data
    workflows.csv - Remediation rules
    migration.sql - Supabase schema
```
