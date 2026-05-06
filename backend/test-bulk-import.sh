#!/usr/bin/env bash
set -u
DAD_ID=$(PGPASSWORD=budgetwise_dev psql -h localhost -U budgetwise -d budgetwise -tAc "SELECT id FROM user_profiles WHERE name='Dad'")
TOK=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"memberId\":\"$DAD_ID\",\"pin\":\"1234\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

echo "Token acquired"
echo
echo "── Test 1: Bulk import 3 valid rows"
curl -s -X POST http://localhost:3000/api/transactions/bulk \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"rows":[{"description":"Costco","amount":120.50,"type":"expense","category":"Groceries","date":"2026-05-01","idempotencyKey":"csv-1"},{"description":"Gas","amount":45.20,"type":"expense","category":"Transport","date":"2026-05-02","idempotencyKey":"csv-2"},{"description":"Bonus","amount":500,"type":"income","category":"Income","date":"2026-05-03","idempotencyKey":"csv-3"}]}' \
  | python3 -m json.tool

echo
echo "── Test 2: Re-import (idempotency skip)"
curl -s -X POST http://localhost:3000/api/transactions/bulk \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"rows":[{"description":"Costco","amount":120.50,"type":"expense","category":"Groceries","date":"2026-05-01","idempotencyKey":"csv-1"},{"description":"Gas","amount":45.20,"type":"expense","category":"Transport","date":"2026-05-02","idempotencyKey":"csv-2"}]}' \
  | python3 -m json.tool

echo
echo "── Test 3: Mix of valid + invalid (whole batch rejected)"
curl -s -w "HTTP %{http_code}\n" -X POST http://localhost:3000/api/transactions/bulk \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"rows":[{"description":"Valid","amount":10,"type":"expense","category":"Groceries","date":"2026-05-04","idempotencyKey":"csv-4"},{"description":"Bad amount","amount":-5,"type":"expense","category":"Groceries","date":"2026-05-04","idempotencyKey":"csv-5"}]}' \
  | head -c 500
echo

echo
echo "── Test 4: Empty batch"
curl -s -w "HTTP %{http_code}\n" -X POST http://localhost:3000/api/transactions/bulk \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"rows":[]}'

echo
echo "── Test 5: Verify spend was incremented in budget categories"
curl -s -H "Authorization: Bearer $TOK" \
  http://localhost:3000/api/budget/categories | python3 -c '
import sys, json
cats = json.load(sys.stdin)
for c in cats:
    if c["name"] in ("Groceries", "Transport"):
        print(f"  {c[\"name\"]:12s} spent=${c[\"amountSpent\"]:>8.2f} of ${c[\"monthlyLimit\"]:>8.2f}")
'

echo
echo "── Test 6: Junior cannot import"
KID_ID=$(PGPASSWORD=budgetwise_dev psql -h localhost -U budgetwise -d budgetwise -tAc "SELECT id FROM user_profiles WHERE name='Sam'")
MOM_ID=$(PGPASSWORD=budgetwise_dev psql -h localhost -U budgetwise -d budgetwise -tAc "SELECT id FROM user_profiles WHERE name='Mom'")
MOM_TOK=$(curl -s -X POST http://localhost:3000/api/auth/admin-login \
  -H "Content-Type: application/json" \
  -d "{\"memberId\":\"$MOM_ID\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s -w "HTTP %{http_code}\n" -X POST http://localhost:3000/api/transactions/bulk \
  -H "Authorization: Bearer $MOM_TOK" -H "Content-Type: application/json" \
  -d "{\"memberId\":\"$KID_ID\",\"rows\":[{\"description\":\"x\",\"amount\":1,\"type\":\"expense\",\"category\":\"Treats & Snacks\",\"date\":\"2026-05-04\"}]}"
