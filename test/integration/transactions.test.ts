import { Mongoose, type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCommerceMongoose,
  type CommerceMongoose,
} from '../../src/index.js';

const uri = process.env.MONGODB_REPLICA_URI;
const integration = uri ? describe : describe.skip;

integration('transactional commerce flow', () => {
  let driver: Mongoose;
  let connection: Connection;
  let commerce: CommerceMongoose;

  beforeAll(async () => {
    driver = new Mongoose();
    connection = await driver
      .createConnection(uri!, {
        dbName: `commerce_transactions_${process.pid}_${Date.now()}`,
        serverSelectionTimeoutMS: 10_000,
      })
      .asPromise();
    commerce = createCommerceMongoose({ connection });
    await commerce.ensureIndexes();
  });

  afterAll(async () => {
    if (connection?.readyState === 1) await connection.dropDatabase();
    await connection?.close();
  });

  it('shares stock, isolates prices, and commits checkout plus capture atomically', async () => {
    const business = await commerce.businesses.create({
      key: 'biz',
      name: 'Business',
    });
    const businessScope = commerce.forBusiness(business.id);
    const first = await businessScope.vendors.create({
      key: 'one',
      name: 'One',
    });
    const second = await businessScope.vendors.create({
      key: 'two',
      name: 'Two',
    });
    const warehouse = await businessScope.warehouses.create({
      code: 'MAIN',
      name: 'Main',
      vendorIds: [first.id, second.id],
    });
    const firstStore = businessScope.forVendor(first.id);
    const secondStore = businessScope.forVendor(second.id);
    await firstStore.catalog.upsertListing({
      variantKey: 'SKU-1',
      title: 'Product',
      price: 100,
    });
    await secondStore.catalog.upsertListing({
      variantKey: 'SKU-1',
      title: 'Product',
      price: 120,
    });
    await firstStore.inventory.adjust({
      warehouseId: warehouse.id,
      variantKey: 'SKU-1',
      quantity: 10,
      reason: 'opening balance',
    });

    const checkout = {
      idempotencyKey: 'checkout-1',
      warehouseId: warehouse.id,
      lines: [{ variantKey: 'SKU-1', quantity: 2 }],
      shippingAddress: {
        recipient: 'Customer',
        phone: '09000000000',
        province: 'Tehran',
        city: 'Tehran',
        address: 'Address',
      },
    };
    const order = await secondStore.orders.checkout(checkout);
    const replay = await secondStore.orders.checkout(checkout);
    expect(order?.id).toBe(replay?.id);
    expect(order?.grandTotal).toBe(240);
    expect(
      (await firstStore.inventory.get(warehouse.id, 'SKU-1'))?.reserved,
    ).toBe(2);

    const payment = await secondStore.payments.createAttempt({
      orderId: order!.id,
      provider: 'test',
      amount: 240,
      idempotencyKey: 'payment-1',
    });
    await secondStore.payments.transition(payment!.id, 'captured');

    const stock = await firstStore.inventory.get(warehouse.id, 'SKU-1');
    expect(stock).toMatchObject({ onHand: 8, reserved: 0 });
    expect(
      await commerce.models.StockMovement.countDocuments({
        businessId: business._id,
        variantKey: 'SKU-1',
      }),
    ).toBe(3);
  });
});
