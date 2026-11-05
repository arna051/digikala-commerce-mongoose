import { z } from 'zod';

const key = z.string().trim().min(1).max(200);
const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a MongoDB ObjectId');
const quantity = z.number().int().positive();
const money = z.number().int().nonnegative();

export const CurrencySchema = z.enum(['IRR']);
export const MoneySchema = z
  .object({ amount: money, currency: CurrencySchema.default('IRR') })
  .strict();

export const BusinessInputSchema = z
  .object({
    key,
    name: key,
    active: z.boolean().default(true),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const VendorInputSchema = z
  .object({
    key,
    name: key,
    active: z.boolean().default(true),
    domains: z.array(key).default([]),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const WarehouseInputSchema = z
  .object({
    code: key,
    name: key,
    active: z.boolean().default(true),
    vendorIds: z.array(objectId).min(1),
    address: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const StockAdjustmentSchema = z
  .object({
    warehouseId: objectId,
    variantKey: key,
    quantity: z
      .number()
      .int()
      .refine((value) => value !== 0),
    reason: key,
    reference: key.optional(),
  })
  .strict();

export const StockReservationSchema = z
  .object({
    warehouseId: objectId,
    variantKey: key,
    quantity,
    orderId: objectId,
    reference: key.optional(),
  })
  .strict();

export const AddressSchema = z
  .object({
    recipient: key,
    phone: key,
    province: key,
    city: key,
    address: key,
    postalCode: key.optional(),
    location: z
      .object({ latitude: z.number(), longitude: z.number() })
      .strict()
      .optional(),
  })
  .strict();

export const CustomerInputSchema = z
  .object({
    phone: key,
    email: z.email().optional(),
    name: key.optional(),
    addresses: z.array(AddressSchema).default([]),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const CartStatusSchema = z.enum(['active', 'converted', 'abandoned']);
export const CartIdentitySchema = z
  .object({
    customerId: objectId.optional(),
    anonymousKey: key.optional(),
    expiresAt: z.coerce.date().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.customerId || value.anonymousKey), {
    message: 'A customerId or anonymousKey is required',
  });

export const CartLineMutationSchema = z
  .object({
    cartId: objectId,
    variantKey: key,
    quantity: z.number().int().nonnegative(),
  })
  .strict();
export const OrderStatusSchema = z.enum([
  'pending_payment',
  'paid',
  'processing',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
  'returned',
]);
export const PaymentStatusSchema = z.enum([
  'pending',
  'authorized',
  'captured',
  'failed',
  'cancelled',
  'partially_refunded',
  'refunded',
]);
export const ShipmentStatusSchema = z.enum([
  'pending',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
]);
export const ReturnStatusSchema = z.enum([
  'requested',
  'approved',
  'rejected',
  'received',
  'refunded',
  'closed',
]);

export const CommerceLineInputSchema = z
  .object({
    variantKey: key,
    sku: key.optional(),
    title: key,
    quantity,
    unitPrice: money,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const VendorListingInputSchema = z
  .object({
    variantKey: key,
    title: key,
    sku: key.optional(),
    price: money,
    compareAtPrice: money.optional(),
    active: z.boolean().default(true),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.compareAtPrice === undefined || value.compareAtPrice >= value.price,
    {
      path: ['compareAtPrice'],
      message: 'Compare-at price must not be below price',
    },
  );

export const CheckoutInputSchema = z
  .object({
    idempotencyKey: key,
    warehouseId: objectId,
    customerId: objectId.optional(),
    lines: z
      .array(z.object({ variantKey: key, quantity }).strict())
      .min(1)
      .superRefine((lines, context) => {
        const keys = lines.map((line) => line.variantKey);
        if (new Set(keys).size !== keys.length) {
          context.addIssue({
            code: 'custom',
            message: 'Each variant may appear only once',
          });
        }
      }),
    shippingAddress: AddressSchema,
    notes: z.string().max(2000).optional(),
    source: z.string().trim().min(1).default('website'),
  })
  .strict();

export const PaymentAttemptInputSchema = z
  .object({
    orderId: objectId,
    provider: key,
    amount: money,
    idempotencyKey: key,
    providerReference: key.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ShipmentInputSchema = z
  .object({
    orderId: objectId,
    warehouseId: objectId,
    carrier: key.optional(),
    trackingCode: key.optional(),
    lines: z.array(z.object({ variantKey: key, quantity }).strict()).min(1),
  })
  .strict();

export const ReturnInputSchema = z
  .object({
    orderId: objectId,
    reason: key,
    lines: z.array(z.object({ variantKey: key, quantity }).strict()).min(1),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const ChannelMappingInputSchema = z
  .object({
    channel: key,
    accountKey: key,
    variantKey: key,
    remoteProductId: key.optional(),
    remoteVariantId: key.optional(),
    active: z.boolean().default(true),
  })
  .strict();

export type WarehouseInput = z.input<typeof WarehouseInputSchema>;
export type BusinessInput = z.input<typeof BusinessInputSchema>;
export type VendorInput = z.input<typeof VendorInputSchema>;
export type StockAdjustment = z.input<typeof StockAdjustmentSchema>;
export type StockReservation = z.input<typeof StockReservationSchema>;
export type CustomerInput = z.input<typeof CustomerInputSchema>;
export type CartIdentity = z.input<typeof CartIdentitySchema>;
export type CartLineMutation = z.input<typeof CartLineMutationSchema>;
export type CheckoutInput = z.input<typeof CheckoutInputSchema>;
export type VendorListingInput = z.input<typeof VendorListingInputSchema>;
export type PaymentAttemptInput = z.input<typeof PaymentAttemptInputSchema>;
export type ShipmentInput = z.input<typeof ShipmentInputSchema>;
export type ReturnInput = z.input<typeof ReturnInputSchema>;
export type ChannelMappingInput = z.input<typeof ChannelMappingInputSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type ShipmentStatus = z.infer<typeof ShipmentStatusSchema>;
export type ReturnStatus = z.infer<typeof ReturnStatusSchema>;
