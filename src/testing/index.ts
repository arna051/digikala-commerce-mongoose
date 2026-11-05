import { Types } from 'mongoose';

export function commerceTestIds() {
  return {
    businessId: new Types.ObjectId().toHexString(),
    vendorId: new Types.ObjectId().toHexString(),
    warehouseId: new Types.ObjectId().toHexString(),
    customerId: new Types.ObjectId().toHexString(),
  };
}

export function checkoutFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    idempotencyKey: new Types.ObjectId().toHexString(),
    warehouseId: new Types.ObjectId().toHexString(),
    lines: [{ variantKey: 'TEST-SKU', quantity: 1 }],
    shippingAddress: {
      recipient: 'Test Customer',
      phone: '09000000000',
      province: 'Tehran',
      city: 'Tehran',
      address: 'Test address',
    },
    ...overrides,
  };
}
