---
skill: receipt
version: 1.0.0
stability: stable
auth: [siwe, api-key]
scopes: [receipt:read]
related_skills: [pay, invoice]
signing: ed25519
public_key_url: /.well-known/flowlink-receipt-pubkey.pem
---

# receipt

Fetch a cryptographic receipt for a settled transaction. Every receipt is ed25519-signed by FlowLink and
verifiable by any third party against the published public key.

## get_receipt

```http
GET /v1/receipts/{receipt_id} HTTP/1.1
Authorization: Bearer <token>
```

Also callable by `transaction_id` or `invoice_id`:

```http
GET /v1/receipts?invoice_id=inv_... HTTP/1.1
GET /v1/receipts?transaction_id=txn_... HTTP/1.1
```

**Response 200**

```json
{
  "receipt_id": "rcp_01HV9Z...",
  "transaction_id": "txn_01HV9Z...",
  "invoice_id": "inv_01HV9Z...",
  "payer_address": "0xPAYER...",
  "receiver_address": "0xPAYEE...",
  "amount": "10.00",
  "token": "USDC",
  "chain_id": 133,
  "tx_hash": "0xabc...",
  "block": 18402913,
  "settled_at": "2026-04-22T14:02:41Z",
  "compliance": {
    "ofac": "clear",
    "velocity": "within_limits",
    "score": 92
  },
  "signature": {
    "algo": "ed25519",
    "signer": "flowlink.ink",
    "key_id": "flk-receipt-2026-04",
    "signed_payload_hash": "sha256:abc...",
    "signature": "base64:...",
    "public_key_url": "https://flowlink.ink/.well-known/flowlink-receipt-pubkey.pem"
  }
}
```

## Verifying a receipt (any language)

The `signed_payload_hash` is a SHA-256 digest over the canonical JSON of every receipt field **except**
`signature`. The signature is ed25519 over that hash.

```python
# pseudocode
import json, hashlib, ed25519
pub = load_pem("flowlink-receipt-pubkey.pem")
payload = {k: v for k, v in receipt.items() if k != "signature"}
canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
digest = hashlib.sha256(canonical).digest()
sig = base64.b64decode(receipt["signature"]["signature"])
pub.verify(sig, digest)  # raises on mismatch
```

## Key rotation

The current key id is published in the `signature.key_id` field. Old receipts remain verifiable after
rotation — historical public keys are listed at
[/.well-known/flowlink-receipt-pubkey.pem](/.well-known/flowlink-receipt-pubkey.pem) with the active key
first and rotated keys after.

## Errors

| code | status | agent should |
|---|---|---|
| `receipt_not_found` | 404 | Check the id. Receipts appear after the `receipt_ready` SSE event. |
| `receipt_not_ready` | 202 | Transaction still settling. Retry in 5 s. |
| `insufficient_scope` | 403 | Need `receipt:read`. |

## Related

- [pay](./pay.md) — `receipt_id` emitted in the final SSE event
- [invoice](./invoice.md) — `invoice_id` works as a lookup key
