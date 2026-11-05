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

    const refund = await secondStore.payments.refund({
      paymentId: payment!.id,
      amount: 40,
      idempotencyKey: 'refund-1',
      reason: 'price adjustment',
    });
    const refundReplay = await secondStore.payments.refund({
      paymentId: payment!.id,
      amount: 40,
      idempotencyKey: 'refund-1',
      reason: 'price adjustment',
    });
    expect(refund?.id).toBe(refundReplay?.id);

    const webhook = await secondStore.payments.recordWebhook({
      provider: 'test',
      eventId: 'event-1',
      payload: { status: 'captured' },
    });
    const webhookReplay = await secondStore.payments.recordWebhook({
      provider: 'test',
      eventId: 'event-1',
      payload: { status: 'captured' },
    });
    expect(webhook.created).toBe(true);
    expect(webhookReplay.created).toBe(false);

    const shipment = await secondStore.fulfillment.createShipment({
      orderId: order!.id,
      warehouseId: warehouse.id,
      lines: [{ variantKey: 'SKU-1', quantity: 2 }],
    });
    await secondStore.fulfillment.transition(shipment!.id, 'packed');
    await secondStore.fulfillment.transition(shipment!.id, 'shipped');
    await secondStore.fulfillment.transition(shipment!.id, 'delivered');

    const returned = await secondStore.returns.create({
      orderId: order!.id,
      reason: 'damaged by customer',
      lines: [{ variantKey: 'SKU-1', quantity: 1 }],
    });
    await secondStore.returns.transition(returned!.id, 'approved');
    await secondStore.returns.transition(returned!.id, 'received', {
      disposition: 'damaged',
    });
    expect(await firstStore.inventory.get(warehouse.id, 'SKU-1')).toMatchObject(
      { onHand: 9, reserved: 0, damaged: 1 },
    );

    const overflow = await businessScope.warehouses.create({
      code: 'OVERFLOW',
      name: 'Overflow',
      vendorIds: [first.id, second.id],
    });
    await firstStore.inventory.transfer({
      fromWarehouseId: warehouse.id,
      toWarehouseId: overflow.id,
      variantKey: 'SKU-1',
      quantity: 2,
      reference: 'transfer-1',
    });
    await firstStore.inventory.reconcile({
      warehouseId: overflow.id,
      variantKey: 'SKU-1',
      countedOnHand: 3,
      reason: 'cycle count',
    });
    expect(await firstStore.inventory.get(overflow.id, 'SKU-1')).toMatchObject({
      onHand: 3,
      reserved: 0,
      damaged: 0,
    });

    await secondStore.promotions.upsert({
      code: 'SAVE20',
      type: 'fixed',
      value: 20,
    });
    const promoted = await secondStore.orders.checkout({
      ...checkout,
      idempotencyKey: 'checkout-promotion',
      lines: [{ variantKey: 'SKU-1', quantity: 1 }],
      promotionCode: 'SAVE20',
    });
    expect(promoted?.grandTotal).toBe(100);
    await secondStore.orders.transition(promoted!.id, 'cancelled');
    expect(
      (await commerce.models.Promotion.findOne({ code: 'SAVE20' }))?.usageCount,
    ).toBe(0);

    const expiringCommerce = createCommerceMongoose({
      connection,
      reservationTtlMs: 1,
    });
    const expiringStore = expiringCommerce.forVendor({
      businessId: business.id,
      vendorId: second.id,
    });
    const expiring = await expiringStore.orders.checkout({
      ...checkout,
      idempotencyKey: 'checkout-expiring',
      lines: [{ variantKey: 'SKU-1', quantity: 1 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await expiringStore.orders.expireReservations()).toContain(
      expiring!.id,
    );
    expect(
      await commerce.models.OutboxEvent.countDocuments({
        businessId: business._id,
      }),
    ).toBeGreaterThan(0);

    const claims = await Promise.all([
      commerce.outbox.claimNext('worker-a'),
      commerce.outbox.claimNext('worker-b'),
    ]);
    expect(claims[0]).not.toBeNull();
    expect(claims[1]).not.toBeNull();
    expect(claims[0]!.id).not.toBe(claims[1]!.id);
    await commerce.outbox.markProcessed(claims[0]!.id);
    await commerce.outbox.markFailed(claims[1]!.id, 'retry test', 1);

    await firstStore.catalog.upsertListing({
      variantKey: 'RACE-SKU',
      title: 'Race product',
      price: 10,
    });
    await firstStore.inventory.adjust({
      warehouseId: warehouse.id,
      variantKey: 'RACE-SKU',
      quantity: 10,
      reason: 'race test stock',
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        firstStore.orders.checkout({
          ...checkout,
          idempotencyKey: `race-${index}`,
          lines: [{ variantKey: 'RACE-SKU', quantity: 1 }],
        }),
      ),
    );
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(10);
    expect(
      await firstStore.inventory.get(warehouse.id, 'RACE-SKU'),
    ).toMatchObject({
      onHand: 10,
      reserved: 10,
      damaged: 0,
    });
  });
});
