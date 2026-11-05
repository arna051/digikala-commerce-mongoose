import { describe, expect, it } from 'vitest';
import {
  CheckoutInputSchema,
  VendorListingInputSchema,
  WarehouseInputSchema,
} from '../src/index.js';

const objectId = '507f1f77bcf86cd799439011';

describe('public commerce contracts', () => {
  it('supports a warehouse shared by multiple storefronts', () => {
    const parsed = WarehouseInputSchema.parse({
      code: 'MAIN',
      name: 'Main warehouse',
      vendorIds: [objectId, '507f1f77bcf86cd799439012'],
    });
    expect(parsed.vendorIds).toHaveLength(2);
  });

  it('rejects misleading compare-at prices', () => {
    expect(() =>
      VendorListingInputSchema.parse({
        variantKey: 'SKU-1',
        title: 'Product',
        price: 200,
        compareAtPrice: 100,
      }),
    ).toThrow();
  });

  it('rejects duplicate checkout variants', () => {
    expect(() =>
      CheckoutInputSchema.parse({
        idempotencyKey: 'checkout-1',
        warehouseId: objectId,
        lines: [
          { variantKey: 'SKU-1', quantity: 1 },
          { variantKey: 'SKU-1', quantity: 2 },
        ],
        shippingAddress: {
          recipient: 'Customer',
          phone: '09000000000',
          province: 'Tehran',
          city: 'Tehran',
          address: 'Address',
        },
      }),
    ).toThrow();
  });
});
