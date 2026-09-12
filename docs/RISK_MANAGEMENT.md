# Risk management (couche ajoutée)

## Gates avant nouvelle entrée live

1. `GLOBAL_KILL_SWITCH=false`
2. `TRADING_MODE=live`
3. `LIVE_TRADING_ENABLED=true`
4. `HL_LIVE_ENABLED=true` (kill historique)
5. Redis durable healthy (ioredis ou Upstash REST)
6. PostgreSQL healthy si `POSTGRES_REQUIRED_FOR_LIVE≠false`
7. `reconciliation_required=false` après `reconcileLiveState`
8. Pas de testnet sauf `ALLOW_TESTNET_LIVE=true`

## Sorties (close)

Les clôtures manuelles `/api/live-close` restent possibles si `HL_LIVE_ENABLED` (réduction de risque), indépendamment du mode shadow — documenté pour ne pas piéger une position ouverte après bascule shadow.

## Réconciliation

`reconcileLiveState` compare positions HL vs `live-journal`.  
Positions HL inconnues du journal → `reconciliation_required=true` → live bloqué.
