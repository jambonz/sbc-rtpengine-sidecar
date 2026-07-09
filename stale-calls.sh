#!/bin/bash

REDIS_HOST="${REDIS_HOST:-jambonz-net-redis.stprbs.0001.use1.cache.amazonaws.com}"
REDIS_PORT="${REDIS_PORT:-6379}"
THRESHOLD_SECS=10800
NOW=$(date +%s)

echo "=== Stale calls (older than 3 hours) ==="
echo ""

STALE=0
TOTAL=0

while read -r key; do
  [ -z "$key" ] && continue
  TOTAL=$((TOTAL + 1))
  TS=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" GET "$key")
  [ -z "$TS" ] && continue

  CALL_EPOCH=$(date -d "$TS" +%s 2>/dev/null || date -jf "%Y-%m-%dT%H:%M:%S" "${TS%%.*}" +%s 2>/dev/null)
  [ -z "$CALL_EPOCH" ] && continue

  AGE=$((NOW - CALL_EPOCH))
  [ "$AGE" -lt "$THRESHOLD_SECS" ] && continue

  STALE=$((STALE + 1))
  HOURS=$((AGE / 3600))
  MINS=$(( (AGE % 3600) / 60 ))

  # key format: debug:incalls:{account_sid}:{call_id}
  STRIPPED="${key#debug:incalls:}"
  ACCOUNT_SID="${STRIPPED%%:*}"
  CALL_ID="${STRIPPED#*:}"

  echo "  account_sid:  $ACCOUNT_SID"
  echo "  sip call-id:  $CALL_ID"
  echo "  started:      $TS"
  echo "  age:          ${HOURS}h ${MINS}m"
  echo ""
done < <(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --scan --pattern "debug:incalls:*")

echo "=== Summary ==="
echo "Total debug keys: $TOTAL"
echo "Stale calls:      $STALE"
