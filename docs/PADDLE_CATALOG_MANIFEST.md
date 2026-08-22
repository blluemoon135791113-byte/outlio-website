# Paddle live catalog manifest

This is the approved creation manifest for the permanent live catalog. Before
creating anything, list the live catalog by name and reuse matching active
products/prices so retries cannot create duplicates.

Every price is recurring, quantity 1, and has a free three-day trial with a
payment method required. The 10-credit trial allowance is enforced by Outlio's
verified subscription mirror, not by Paddle.

| Product | Cycle | USD base | UK override | Ireland override | Australia override |
|---|---:|---:|---:|---:|---:|
| Lead Engine | Monthly | $28.00 (`2800`) | £22.00 (`2200`) | €25.00 (`2500`) | A$42.00 (`4200`) |
| Lead Engine | Yearly | $245.00 (`24500`) | £190.00 (`19000`) | €219.00 (`21900`) | A$369.00 (`36900`) |
| Pro | Monthly | $43.00 (`4300`) | £34.00 (`3400`) | €39.00 (`3900`) | A$65.00 (`6500`) |
| Pro | Yearly | $380.00 (`38000`) | £299.00 (`29900`) | €345.00 (`34500`) | A$575.00 (`57500`) |
| Pro + Hubble | Monthly | $69.00 (`6900`) | £54.00 (`5400`) | €62.00 (`6200`) | A$104.00 (`10400`) |
| Pro + Hubble | Yearly | $612.00 (`61200`) | £479.00 (`47900`) | €549.00 (`54900`) | A$919.00 (`91900`) |

These are rounded launch prices rather than continually fluctuating exchange
rates. Paddle selects the matching `GB`, `IE`, or `AU` override using checkout
location. Other countries use Paddle's localized presentation of the USD base
price. Outlio passes a valid Vercel country header when present and otherwise
lets Paddle detect the visitor from their IP.

Each price creation request uses this shape (substitute the row amounts):

```json
{
  "product_id": "pro_...",
  "name": "Monthly",
  "billing_cycle": { "interval": "month", "frequency": 1 },
  "trial_period": {
    "interval": "day",
    "frequency": 3,
    "requires_payment_method": true
  },
  "unit_price": { "amount": "2800", "currency_code": "USD" },
  "unit_price_overrides": [
    { "country_codes": ["GB"], "unit_price": { "amount": "2200", "currency_code": "GBP" } },
    { "country_codes": ["IE"], "unit_price": { "amount": "2500", "currency_code": "EUR" } },
    { "country_codes": ["AU"], "unit_price": { "amount": "4200", "currency_code": "AUD" } }
  ]
}
```

Products use tax category `saas` and these permanent internal plan mappings:

- Lead Engine → `starter`
- Pro → `professional`
- Pro + Hubble → `custom`

After creation, write the six returned `pri_...` IDs into the matching Paddle
environment variables. Record all three `pro_...` IDs alongside them.
