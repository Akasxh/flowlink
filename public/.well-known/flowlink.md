# FlowLink — agent quickstart

You are an AI agent. Read this file. Then use FlowLink to pay an invoice on HashKey testnet in under 60 seconds.

## What FlowLink does

FlowLink lets agents create crypto invoices and settle them in stablecoins on HashKey Chain (id 133). Every
settlement is screened for sanctions (OFAC) and velocity limits before funds move. Every successful payment
emits an ed25519-signed receipt that any third party can verify against the public key at
[`/.well-known/flowlink-receipt-pubkey.pem`](./flowlink-receipt-pubkey.pem).

## The five skills

| skill | endpoint | spec |
|---|---|---|
| invoice | `POST /v1/invoices` | [/skills/invoice.md](/skills/invoice.md) |
| pay | `POST /v1/pay` | [/skills/pay.md](/skills/pay.md) |
| compliance | `POST /v1/compliance/check` | [/skills/compliance.md](/skills/compliance.md) |
| receipt | `GET /v1/receipts/{id}` | [/skills/receipt.md](/skills/receipt.md) |
| reputation | `GET /v1/reputation/{address}` | [/skills/reputation.md](/skills/reputation.md) |

## Auth in 15 seconds

```sh
# 1. Ask for a nonce
curl -s -X POST https://flowlink.ink/v1/auth/siwe/nonce \
  -H 'Content-Type: application/json' \
  -d '{"address":"0xYOUR_WALLET"}'
# => {"nonce":"...","message":"flowlink.ink wants you to sign in ...","expires_in":300}

# 2. Sign the message with your wallet key, then verify
curl -s -X POST https://flowlink.ink/v1/auth/siwe/verify \
  -H 'Content-Type: application/json' \
  -d '{"message":"<the exact message>","signature":"0x..."}'
# => {"access_token":"eyJ...","scopes":["invoice:write","pay:execute",...],"expires_in":3600}
```

For dev/test without a wallet, generate a scoped API key at `/dashboard/keys` (human login required) and
send it as `Authorization: Bearer flk_test_...`.

## Happy-path curl (invoice → pay → receipt)

```sh
JWT="eyJ..."                           # from the SIWE step above
IDEM=$(uuidgen)

# Create an invoice
INVOICE=$(curl -s -X POST https://flowlink.ink/v1/invoices \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: $IDEM-inv" \
  -H 'Content-Type: application/json' \
  -d '{"amount":"0.01","token":"USDC","receiver_address":"0xPAYEE","purpose":"test"}')

INVOICE_ID=$(echo "$INVOICE" | jq -r .invoice_id)

# Pay it
curl -s -X POST https://flowlink.ink/v1/pay \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: $IDEM-pay" \
  -H 'Content-Type: application/json' \
  -d "{\"invoice_id\":\"$INVOICE_ID\",\"payer_address\":\"0xPAYER\",\"token\":\"USDC\"}"
# => {"transaction_id":"txn_...","status":"mandate_created","checkout_url":"https://checkout.hsp...",...}

# Wait for settlement (SSE)
curl -N -H "Authorization: Bearer $JWT" \
  https://flowlink.ink/v1/transactions/$TXN/events

# Fetch signed receipt
curl -s -H "Authorization: Bearer $JWT" \
  https://flowlink.ink/v1/receipts/$RECEIPT_ID
```

## Contract guarantees

- Every `/v1/*` call requires `Authorization: Bearer` and returns Problem+JSON errors.
- Every write call requires `Idempotency-Key`; duplicate keys replay the original response.
- OFAC screening fails **closed** — if our upstream check is unreachable, your pay call is blocked.
- Receipts are ed25519-signed; verify with the public key at `/.well-known/flowlink-receipt-pubkey.pem`.

## If anything fails

Every error has a `code` and an `agent_action` field telling you what to do. See
[`/skills/errors.md`](/skills/errors.md) for the full catalogue.
