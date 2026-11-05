# Contributing

Use Node.js 20 or newer. Start the test replica set with `docker compose up -d`,
then run:

```bash
npm install
npm run verify
MONGODB_URI='mongodb://127.0.0.1:27019/?directConnection=true&replicaSet=commerce-rs' \
MONGODB_REPLICA_URI='mongodb://127.0.0.1:27019/?directConnection=true&replicaSet=commerce-rs' \
npm run test:integration
```

All stock and money mutations must remain vendor-isolated, idempotent, and
transaction tested.
