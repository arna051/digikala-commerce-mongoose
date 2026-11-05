import { Mongoose, type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCommerceMongoose,
  type CommerceMongoose,
} from '../../src/index.js';

const uri = process.env.MONGODB_URI;
const integration = uri ? describe : describe.skip;

integration('real MongoDB integration', () => {
  let driver: Mongoose;
  let connection: Connection;
  let commerce: CommerceMongoose;

  beforeAll(async () => {
    driver = new Mongoose();
    connection = await driver
      .createConnection(uri!, {
        dbName: `commerce_mongoose_${process.pid}_${Date.now()}`,
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

  it('keeps vendor prices separate while sharing one warehouse', async () => {
    const business = await commerce.businesses.create({
      key: 'integration-business',
      name: 'Integration Business',
    });
    const scoped = commerce.forBusiness(business.id);
    const first = await scoped.vendors.create({
      key: 'one',
      name: 'Store One',
    });
    const second = await scoped.vendors.create({
      key: 'two',
      name: 'Store Two',
    });
    const warehouse = await scoped.warehouses.create({
      code: 'MAIN',
      name: 'Main',
      vendorIds: [first.id, second.id],
    });

    const firstStore = scoped.forVendor(first.id);
    const secondStore = scoped.forVendor(second.id);
    await firstStore.catalog.upsertListing({
      variantKey: 'SHARED-SKU',
      title: 'Shared product',
      price: 100,
    });
    await secondStore.catalog.upsertListing({
      variantKey: 'SHARED-SKU',
      title: 'Shared product',
      price: 120,
    });

    expect((await firstStore.catalog.findListing('SHARED-SKU'))?.price).toBe(
      100,
    );
    expect((await secondStore.catalog.findListing('SHARED-SKU'))?.price).toBe(
      120,
    );
    expect((await firstStore.warehouses.list()).map(String)).not.toHaveLength(
      0,
    );
    expect(String(warehouse.businessId)).toBe(business.id);
  });

  it('rejects attaching another business vendor to a warehouse', async () => {
    const other = await commerce.businesses.create({
      key: 'other-business',
      name: 'Other Business',
    });
    const otherVendor = await commerce
      .forBusiness(other.id)
      .vendors.create({ key: 'other', name: 'Other Store' });
    const firstBusiness = await commerce.businesses.findByKey(
      'integration-business',
    );

    await expect(
      commerce.forBusiness(firstBusiness!.id).warehouses.create({
        code: 'INVALID',
        name: 'Invalid',
        vendorIds: [otherVendor.id],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
