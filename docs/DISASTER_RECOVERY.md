# Disaster recovery

| Incident | Action |
|---|---|
| Crash worker | `restart: unless-stopped` / relancer tsx ; heartbeat Redis expire |
| Redis down | LIVE bloqué automatiquement ; paper/shadow OK ; dashboard degraded |
| Postgres down | LIVE bloqué si `POSTGRES_REQUIRED_FOR_LIVE` ; restaurer backup volume |
| WebSocket/data stale | market-data degraded → pas de nouvelles entrées live |
| Position HL inconnue | `reconcile` → `reconciliation_required` → investigate avant live |
| Ordre douteux timeout | Ne pas retry aveugle ; vérifier fills HL ; journaliser CRITICAL |
| Urgence | `GLOBAL_KILL_SWITCH=true` via `/api/bot/control` ou env |

Backup PG : `docker exec … pg_dump` vers stockage sécurisé.  
Ne jamais restaurer de secrets dans la DB (il n’y en a pas par design).
