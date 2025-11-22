# Docker Container Isolation

This document explains how the PWA example project is isolated from other Docker containers.

## Isolation Strategies Implemented

### 1. **Custom Docker Network**
- **Network Name**: `pwa_example_network`
- **Driver**: `bridge`
- All containers communicate within this isolated network
- No conflicts with other Docker projects' networks

### 2. **Unique Container Names**
- PostgreSQL: `pwa-example-postgres`
- Backend: `pwa-example-backend`
- Frontend: `pwa-example-frontend`
- Prevents naming conflicts with other containers

### 3. **Project-Specific Volume**
- **Volume Name**: `pwa_example_postgres_data`
- Isolated data storage
- No interference from other PostgreSQL instances

### 4. **Port Isolation**
- **Host Port**: `5433` (instead of default 5432)
- **Container Port**: `5432` (internal)
- Allows multiple PostgreSQL instances to run simultaneously
- Access from host: `localhost:5433`

### 5. **Database Connection Improvements**
- Connection retry logic with exponential backoff
- Better error messages showing database/user info
- Health checks verify actual database accessibility

## How It Works

```
┌─────────────────────────────────────────┐
│  pwa_example_network (isolated)        │
│                                         │
│  ┌──────────────┐  ┌──────────────┐   │
│  │   Postgres   │  │   Backend    │   │
│  │  (internal:  │◄─┤  connects to │   │
│  │   5432)      │  │  postgres:   │   │
│  └──────────────┘  │   5432       │   │
│         │          └──────────────┘   │
│         │          ┌──────────────┐   │
│         └──────────┤   Frontend   │   │
│                    └──────────────┘   │
└─────────────────────────────────────────┘
         │
         │ (exposed ports)
         ▼
   Host Machine
   - 5433 → postgres
   - 3000 → backend
   - 5173 → frontend
```

## Benefits

1. **No Conflicts**: Can run alongside other Docker PostgreSQL instances
2. **Clean Separation**: Each project has its own network and volumes
3. **Easy Cleanup**: Remove everything with:
   ```bash
   docker-compose down -v
   ```
4. **Multiple Projects**: Run multiple PWA instances by changing:
   - Container names
   - Network name
   - Volume name
   - Host ports

## Troubleshooting

### Check if containers are isolated:
```bash
# List containers
docker ps

# Check network
docker network ls | grep pwa_example

# Check volumes
docker volume ls | grep pwa_example
```

### Clean up (if needed):
```bash
# Stop and remove containers
docker-compose down

# Also remove volumes (⚠️ deletes data)
docker-compose down -v

# Remove network manually if needed
docker network rm pwa_example_network
```

### Verify PostgreSQL user exists:
```bash
# Connect to the isolated PostgreSQL
docker exec -it pwa-example-postgres psql -U pwa_user -d pwa_db

# Should show: pwa_db=>
```

## Connection String Reference

- **From Backend Container**: `postgresql://pwa_user:pwa_password@postgres:5432/pwa_db`
- **From Host Machine**: `postgresql://pwa_user:pwa_password@localhost:5433/pwa_db`

Note: Inside Docker containers, use service name `postgres` and internal port `5432`.
From host machine, use `localhost` and exposed port `5433`.

