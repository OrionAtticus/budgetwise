#!/usr/bin/env bash
# End-to-end smoke test for the BudgetWise API.
# Assumes the API is running on localhost:3000 with seeded data.

set -u
API="${API:-http://localhost:3000}"
PASS=0
FAIL=0
declare -a FAILURES

cyan()   { printf "\033[36m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

# `check NAME EXPECTED_STATUS COMMAND...` runs COMMAND, asserts the last
# stored HTTP status equals EXPECTED_STATUS, and pretty-prints the body.
last_body=""
last_status=""

req() {
  local method=$1; local path=$2; local body="${3:-}"; local auth="${4:-}"
  local out
  if [[ -n "$body" ]]; then
    out=$(curl -sS -o /tmp/body.json -w "%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      ${auth:+-H "Authorization: Bearer $auth"} \
      -d "$body" "$API$path")
  else
    out=$(curl -sS -o /tmp/body.json -w "%{http_code}" -X "$method" \
      ${auth:+-H "Authorization: Bearer $auth"} \
      "$API$path")
  fi
  last_status=$out
  last_body=$(cat /tmp/body.json)
}

check() {
  local name=$1; local expected=$2
  if [[ "$last_status" == "$expected" ]]; then
    green "  ✓ $name  ($last_status)"
    PASS=$((PASS+1))
  else
    red "  ✗ $name  expected $expected got $last_status"
    red "    body: $last_body"
    FAIL=$((FAIL+1))
    FAILURES+=("$name")
  fi
}

# ───────────────────────────────────────────────────────────────────
cyan "=== Health & Discovery ==="
req GET /health
check "GET /health" 200

req GET /api/nope
check "404 for unknown endpoint" 404

# ───────────────────────────────────────────────────────────────────
cyan "=== Profile lookup before login ==="
# We need member IDs to log in. Use psql for this — in production the
# frontend would get them from a hypothetical /api/family/profiles-public,
# but our profile listing requires auth. We do a one-off SQL lookup here.
MOM_ID=$(PGPASSWORD=budgetwise_dev psql -h localhost -U budgetwise -d budgetwise -tAc \
  "SELECT id FROM user_profiles WHERE name='Mom'")
DAD_ID=$(PGPASSWORD=budgetwise_dev psql -h localhost -U budgetwise -d budgetwise -tAc \
  "SELECT id FROM user_profiles WHERE name='Dad'")
TEEN_ID=$(PGPASSWORD=budgetwise_dev psql -h localhost -U budgetwise -d budgetwise -tAc \
  "SELECT id FROM user_profiles WHERE name='Jordan'")
KID_ID=$(PGPASSWORD=budgetwise_dev psql -h localhost -U budgetwise -d budgetwise -tAc \
  "SELECT id FROM user_profiles WHERE name='Sam'")
echo "  Mom: $MOM_ID"
echo "  Dad: $DAD_ID"
echo "  Jordan: $TEEN_ID"
echo "  Sam: $KID_ID"

# ───────────────────────────────────────────────────────────────────
cyan "=== Auth ==="

# Wrong PIN should fail
req POST /api/auth/login "{\"memberId\":\"$DAD_ID\",\"pin\":\"9999\"}"
check "Login with wrong PIN → 401" 401

# Right PIN should succeed
req POST /api/auth/login "{\"memberId\":\"$DAD_ID\",\"pin\":\"1234\"}"
check "Login with correct PIN → 200" 200
DAD_TOKEN=$(echo "$last_body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')
echo "  dad token: ${DAD_TOKEN:0:16}…"

# Admin login (PIN bypass per spec)
req POST /api/auth/admin-login "{\"memberId\":\"$MOM_ID\"}"
check "Admin PIN bypass → 200" 200
MOM_TOKEN=$(echo "$last_body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')

# Non-admin trying admin-login should be forbidden
req POST /api/auth/admin-login "{\"memberId\":\"$DAD_ID\"}"
check "Admin PIN bypass for non-admin → 403" 403

# /me with no token → 401
req GET /api/auth/me
check "GET /me without token → 401" 401

# /me with token
req GET /api/auth/me "" "$DAD_TOKEN"
check "GET /me with token → 200" 200

# ───────────────────────────────────────────────────────────────────
cyan "=== Family & Profiles ==="

req GET /api/family "" "$DAD_TOKEN"
check "GET /family → 200" 200

req GET /api/profiles "" "$DAD_TOKEN"
check "GET /profiles → 200 (4 members)" 200
NPROF=$(echo "$last_body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))')
[[ "$NPROF" == "4" ]] && green "  ✓ profile count = 4" || { red "  ✗ profile count = $NPROF"; FAIL=$((FAIL+1)); }

# Non-admin cannot create profiles
req POST /api/profiles '{"name":"Sneaky","role":"member","pin":"0000"}' "$DAD_TOKEN"
check "Non-admin POST /profiles → 403" 403

# Admin can create
req POST /api/profiles '{"name":"Grandma","email":"grandma@johnson.com","role":"member","monthlyLimit":500,"pin":"5678"}' "$MOM_TOKEN"
check "Admin POST /profiles → 201" 201

# ───────────────────────────────────────────────────────────────────
cyan "=== Transactions ==="

# Dad logs an expense
req POST /api/transactions \
  '{"description":"Test grocery run","amount":42.50,"type":"expense","category":"Groceries","date":"2026-05-03"}' \
  "$DAD_TOKEN"
check "Dad logs expense → 201" 201
TX_ID=$(echo "$last_body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).transaction.id))')

# Idempotency: same key twice → 409
req POST /api/transactions \
  '{"description":"Idem test","amount":5,"type":"expense","category":"Groceries","date":"2026-05-03","idempotencyKey":"unique-1"}' \
  "$DAD_TOKEN"
check "First idempotent insert → 201" 201

req POST /api/transactions \
  '{"description":"Idem test","amount":5,"type":"expense","category":"Groceries","date":"2026-05-03","idempotencyKey":"unique-1"}' \
  "$DAD_TOKEN"
check "Duplicate idempotency key → 409" 409

# Junior cannot log
req POST /api/transactions \
  "{\"memberId\":\"$KID_ID\",\"description\":\"forbidden\",\"amount\":1,\"type\":\"expense\",\"category\":\"Treats & Snacks\",\"date\":\"2026-05-03\"}" \
  "$MOM_TOKEN"
check "Admin logging tx for junior → 400 (Junior cannot log)" 400

# Teen with disallowed category should 400
req POST /api/transactions \
  "{\"memberId\":\"$TEEN_ID\",\"description\":\"luxury\",\"amount\":50,\"type\":\"expense\",\"category\":\"Tech & Gadgets\",\"date\":\"2026-05-03\"}" \
  "$MOM_TOKEN"
check "Admin logging Teen tx with bad category → 400" 400

# List Dad's transactions
req GET "/api/transactions?limit=5" "" "$DAD_TOKEN"
check "GET /transactions → 200" 200

# Dad cannot view Mom's tx
req GET "/api/transactions?memberId=$MOM_ID" "" "$DAD_TOKEN"
check "Dad viewing Mom's tx → 403" 403

# Admin can
req GET "/api/transactions?memberId=$DAD_ID&limit=5" "" "$MOM_TOKEN"
check "Admin viewing Dad's tx → 200" 200

# ───────────────────────────────────────────────────────────────────
cyan "=== Budget ==="

req GET /api/budget/categories "" "$DAD_TOKEN"
check "GET /budget/categories → 200" 200
NCAT=$(echo "$last_body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))')
[[ "$NCAT" == "5" ]] && green "  ✓ Dad has 5 categories" || red "  ✗ Dad has $NCAT categories"

req POST /api/budget/categories '{"name":"Coffee","icon":"☕","monthlyLimit":50}' "$DAD_TOKEN"
check "POST /budget/categories → 201" 201

# ───────────────────────────────────────────────────────────────────
cyan "=== Goals ==="

req GET /api/goals "" "$DAD_TOKEN"
check "GET /goals → 200" 200

req POST /api/goals '{"name":"Test goal","targetAmount":500,"deadline":"2026-12-31"}' "$DAD_TOKEN"
check "POST /goals → 201" 201
GOAL_ID=$(echo "$last_body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')

req POST "/api/goals/$GOAL_ID/contribute" '{"amount":75}' "$DAD_TOKEN"
check "POST /goals/:id/contribute → 200" 200

req GET /api/goals/family "" "$DAD_TOKEN"
check "GET /goals/family → 200 (shared goals)" 200

# ───────────────────────────────────────────────────────────────────
cyan "=== Notifications ==="

req POST /api/notifications \
  "{\"recipientId\":\"$TEEN_ID\",\"type\":\"nudge\",\"title\":\"Slow your roll\",\"body\":\"You're over budget\"}" \
  "$MOM_TOKEN"
check "Admin sends nudge → 201" 201

# Non-admin cannot
req POST /api/notifications \
  "{\"recipientId\":\"$TEEN_ID\",\"type\":\"nudge\",\"title\":\"hi\"}" \
  "$DAD_TOKEN"
check "Non-admin nudge → 403" 403

# ───────────────────────────────────────────────────────────────────
cyan "=== Dashboard (server-side aggregation) ==="

req GET /api/dashboard/me "" "$DAD_TOKEN"
check "GET /dashboard/me → 200" 200

# Verify totals look right
echo "$last_body" | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const d = JSON.parse(s);
  console.log("    period:", d.period);
  console.log("    income:", d.totals.income);
  console.log("    spent:",  d.totals.spent);
  console.log("    remaining:", d.totals.remaining);
  console.log("    savingsRate:", d.totals.savingsRate);
  console.log("    categories:", d.categories.length);
  console.log("    goals:", d.goals.length);
  console.log("    recentTx:", d.recentTransactions.length);
});'

# Cache hit second time
req GET /api/dashboard/me "" "$DAD_TOKEN"
check "GET /dashboard/me cache hit → 200" 200
CACHED=$(echo "$last_body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).cached))')
[[ "$CACHED" == "true" ]] && green "  ✓ second call served from cache" || red "  ✗ cache miss on repeat call (cached=$CACHED)"

req GET /api/dashboard/family "" "$MOM_TOKEN"
check "GET /dashboard/family → 200" 200

# ───────────────────────────────────────────────────────────────────
cyan "=== Logout ==="

req POST /api/auth/logout "" "$DAD_TOKEN"
check "POST /logout → 200" 200

req GET /api/auth/me "" "$DAD_TOKEN"
check "Token invalid after logout → 401" 401

# ───────────────────────────────────────────────────────────────────
echo
if [[ $FAIL -eq 0 ]]; then
  green "═══ ALL $PASS TESTS PASSED ═══"
else
  red "═══ $FAIL TEST(S) FAILED, $PASS PASSED ═══"
  for f in "${FAILURES[@]}"; do red "  - $f"; done
  exit 1
fi
