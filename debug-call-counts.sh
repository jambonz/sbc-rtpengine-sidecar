#!/bin/bash

REDIS_HOST="${REDIS_HOST:-jambonz-net-redis.stprbs.0001.use1.cache.amazonaws.com}"
REDIS_PORT="${REDIS_PORT:-6379}"

if [ -z "$1" ]; then
  echo "Usage: $0 <account_sid>"
  exit 1
fi

ACCOUNT_SID="$1"

echo "=== Account call count ==="
COUNT=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" GET "incalls:account:$ACCOUNT_SID")
echo "incalls:account:$ACCOUNT_SID => ${COUNT:-0}"

echo ""
echo "=== Individual calls (debug keys) ==="
CALL_COUNT=0
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --scan --pattern "debug:incalls:$ACCOUNT_SID:*" | while read -r key; do
  CALL_COUNT=$((CALL_COUNT + 1))
  TS=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" GET "$key")
  CALL_ID="${key##*:}"
  echo "  $CALL_ID  started: $TS"
done

echo ""
DEBUG_COUNT=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --scan --pattern "debug:incalls:$ACCOUNT_SID:*" | wc -l | tr -d ' ')
echo "=== Summary ==="
echo "Account counter:  ${COUNT:-0}"
echo "Debug call keys:  $DEBUG_COUNT"
if [ "${COUNT:-0}" != "$DEBUG_COUNT" ]; then
  echo "** MISMATCH — counter may be leaked **"
fi
