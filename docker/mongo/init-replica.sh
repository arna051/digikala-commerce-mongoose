#!/usr/bin/env bash
set -euo pipefail

mongosh --host mongo:27017 --quiet --eval '
try {
  void rs.status();
} catch (error) {
  rs.initiate({
    _id: "commerce-rs",
    members: [{ _id: 0, host: "mongo:27017" }]
  });
}
'

for attempt in {1..30}; do
  if mongosh --host mongo:27017 --quiet --eval \
    'quit(db.hello().isWritablePrimary ? 0 : 1)' >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo "MongoDB replica set did not become writable" >&2
exit 1
