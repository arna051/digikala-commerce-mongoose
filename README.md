# digikala-commerce-mongoose

By: Hippogriff Studio  
[https://hippogriff.ir](https://hippogriff.ir)  
Call: +98 903 871 9255

A transaction-safe Mongoose commerce domain for independent stores. It lets a
small team build one website with one vendor, or run several vendor storefronts
from one backend while sharing the same physical inventory.

This is **not** a marketplace engine. It has no seller commissions, settlement
accounts, seller payouts, or per-order revenue splitting.

## Domain model

```text
Business
├── Vendor / storefront A ── own domain, listings, prices, carts and orders
├── Vendor / storefront B ── own domain, listings, prices, carts and orders
└── Warehouses ───────────── shared stock source of truth
```

A vendor is a customer-facing store or brand. A business owns vendors and
warehouses. A warehouse explicitly lists which vendors may sell from it.
Inventory is keyed by business, warehouse, and variant—not by vendor—so two
websites can offer different prices while atomically consuming one quantity.

## Included

- Businesses, vendor storefronts, domains and settings
- Shared or vendor-dedicated warehouses
- Vendor-specific product listings and prices
- Atomic stock adjustments, reservations, sales, releases and returns
- Reservation expiry, warehouse transfers, cycle counts and damaged stock
- Customers, addresses and carts
- Idempotent checkout with immutable title/price snapshots
- Orders and guarded state transitions
- Payment attempts, capture, idempotent webhooks and partial/full refunds
- Multiple shipments, partial fulfillment and inspected return dispositions
- Optional external channel mappings
- Append-only stock movements and audit events
- Transactional outbox events for reliable worker integrations

The package uses integer Iranian rial (`IRR`) amounts. It never accepts a
browser-supplied checkout price: checkout resolves the current vendor listing
inside the transaction.

## Installation

```bash
npm install digikala-commerce-mongoose mongoose
```

Commerce mutations require MongoDB transactions. Production deployments must
use a replica set; a single-node replica set is appropriate for a small store.

For local development, the included Docker setup starts one:

```bash
docker compose up -d --wait mongo
docker compose run --rm mongo-init
```

Connect with:

```text
mongodb://127.0.0.1:27019/?directConnection=true&replicaSet=commerce-rs
```

## Setup

```ts
import mongoose from 'mongoose';
import { createCommerceMongoose } from 'digikala-commerce-mongoose';

await mongoose.connect(process.env.MONGODB_URI!);

const commerce = createCommerceMongoose({
  connection: mongoose.connection,
});

await commerce.ensureReady();

const business = await commerce.businesses.create({
  key: 'hippogriff-retail',
  name: 'Hippogriff Retail',
});

const businessCommerce = commerce.forBusiness(business.id);
const vapeStore = await businessCommerce.vendors.create({
  key: 'vape-store',
  name: 'Vape Store',
  domains: ['vape.example.com'],
});
const perfumeStore = await businessCommerce.vendors.create({
  key: 'perfume-store',
  name: 'Perfume Store',
  domains: ['perfume.example.com'],
});

const warehouse = await businessCommerce.warehouses.create({
  code: 'MAIN',
  name: 'Main warehouse',
  vendorIds: [vapeStore.id, perfumeStore.id],
});
```

For a one-store business, create one business, one vendor, and one warehouse.
The operational API is then bound once and requires no repeated tenant IDs:

```ts
const store = commerce.forVendor({
  businessId: business.id,
  vendorId: vapeStore.id,
});
```

## Different storefront prices, shared quantity

```ts
await store.catalog.upsertListing({
  variantKey: 'SKU-RED-L',
  title: 'Red Shirt - Large',
  price: 12_000_000,
});

const secondStore = commerce.forVendor({
  businessId: business.id,
  vendorId: perfumeStore.id,
});
await secondStore.catalog.upsertListing({
  variantKey: 'SKU-RED-L',
  title: 'Red Shirt - Large',
  price: 12_500_000,
});
```

Both listings reserve from the same `warehouse + SKU-RED-L` inventory record.

## Checkout

```ts
const order = await store.orders.checkout({
  idempotencyKey: crypto.randomUUID(),
  warehouseId: warehouse.id,
  lines: [{ variantKey: 'SKU-RED-L', quantity: 1 }],
  shippingAddress: {
    recipient: 'Example Customer',
    phone: '09...',
    province: 'Tehran',
    city: 'Tehran',
    address: 'Example address',
  },
});
```

Checkout, inventory reservations, the order, idempotency record, stock
movements, and audit event commit together or roll back together.

Abandoned checkout stock is released by a worker:

```ts
await store.orders.expireReservations(100);
```

## NestJS

```ts
import { Module } from '@nestjs/common';
import { DigikalaCommerceModule } from 'digikala-commerce-mongoose/nestjs';

@Module({
  imports: [
    DigikalaCommerceModule.forRoot({ connection: mongoose.connection }),
  ],
})
export class AppModule {}
```

Inject `COMMERCE_MONGOOSE` to access the initialized facade. NestJS is an
optional peer dependency; plain Node.js users do not install it.

## Workers and outbox

Every audited business event is written to the outbox in the same transaction.
A worker atomically claims one event with a renewable lease, performs external
work, then marks it processed:

```ts
while (true) {
  const event = await commerce.outbox.claimNext('worker-1', 30_000);
  if (!event) break;

  try {
    await publish(event.topic, event.payload);
    await commerce.outbox.markProcessed(event.id);
  } catch (error) {
    await commerce.outbox.markFailed(event.id, String(error));
  }
}
```

Outbox delivery is at least once. External consumers must therefore use the
event ID as an idempotency key. A crashed worker's lease expires so another
worker can retry the event.

## Relationship with the other packages

- `digikala`: Digikala authentication and API integration.
- `digikala-mongoose`: Digikala-compatible catalog drafts and publication data.
- `digikala-commerce-mongoose`: your website's operational commerce domain.

The packages deliberately communicate through stable keys such as
`variantKey`; the commerce package does not force Digikala onto stores that do
not need it.

## Donate

If this package saves your team time, please support Hippogriff Studio and help
fund continued maintenance.
