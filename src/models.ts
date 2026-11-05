import {
  Schema,
  type Connection,
  type InferSchemaType,
  type Model,
} from 'mongoose';

const options = { timestamps: true, versionKey: 'version' } as const;
const money = { type: Number, required: true, min: 0 } as const;

const addressSchema = new Schema(
  {
    recipient: { type: String, required: true },
    phone: { type: String, required: true },
    province: { type: String, required: true },
    city: { type: String, required: true },
    address: { type: String, required: true },
    postalCode: String,
    location: { latitude: Number, longitude: Number },
  },
  { _id: false },
);

const lineSchema = new Schema(
  {
    variantKey: { type: String, required: true },
    sku: String,
    title: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: money,
    lineTotal: money,
    metadata: Schema.Types.Mixed,
  },
  { _id: false },
);

export const businessSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    settings: Schema.Types.Mixed,
  },
  options,
);

export const vendorSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    domains: { type: [String], default: [] },
    settings: Schema.Types.Mixed,
  },
  options,
);
vendorSchema.index({ businessId: 1, key: 1 }, { unique: true });
vendorSchema.index(
  { domains: 1 },
  { unique: true, partialFilterExpression: { domains: { $type: 'string' } } },
);

export const warehouseSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorIds: { type: [Schema.Types.ObjectId], required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    address: Schema.Types.Mixed,
  },
  options,
);
warehouseSchema.index({ businessId: 1, code: 1 }, { unique: true });

export const inventorySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    warehouseId: { type: Schema.Types.ObjectId, required: true, index: true },
    variantKey: { type: String, required: true },
    onHand: { type: Number, required: true, min: 0, default: 0 },
    reserved: { type: Number, required: true, min: 0, default: 0 },
    damaged: { type: Number, required: true, min: 0, default: 0 },
  },
  { ...options, optimisticConcurrency: true },
);
inventorySchema.index(
  { businessId: 1, warehouseId: 1, variantKey: 1 },
  { unique: true },
);

export const stockMovementSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, index: true },
    warehouseId: { type: Schema.Types.ObjectId, required: true, index: true },
    variantKey: { type: String, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, index: true },
    type: {
      type: String,
      enum: [
        'adjustment',
        'reservation',
        'release',
        'sale',
        'return',
        'damage',
        'transfer_in',
        'transfer_out',
      ],
      required: true,
    },
    onHandDelta: { type: Number, required: true },
    reservedDelta: { type: Number, required: true },
    damagedDelta: { type: Number, required: true, default: 0 },
    reason: { type: String, required: true },
    reference: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const reservationSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    warehouseId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    variantKey: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['active', 'released', 'committed', 'expired'],
      default: 'active',
      required: true,
    },
    expiresAt: { type: Date, required: true, index: true },
  },
  options,
);
reservationSchema.index(
  { businessId: 1, orderId: 1, variantKey: 1 },
  { unique: true },
);

export const stockTransferSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    fromWarehouseId: { type: Schema.Types.ObjectId, required: true },
    toWarehouseId: { type: Schema.Types.ObjectId, required: true },
    variantKey: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    reference: String,
    status: { type: String, enum: ['completed'], default: 'completed' },
  },
  options,
);

export const customerSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
    phone: { type: String, required: true },
    email: String,
    name: String,
    addresses: { type: [addressSchema], default: [] },
    metadata: Schema.Types.Mixed,
  },
  options,
);
customerSchema.index({ businessId: 1, phone: 1 }, { unique: true });
customerSchema.index(
  { businessId: 1, email: 1 },
  { unique: true, sparse: true },
);

export const cartSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, index: true },
    anonymousKey: { type: String, sparse: true, index: true },
    status: {
      type: String,
      enum: ['active', 'converted', 'abandoned'],
      default: 'active',
    },
    lines: { type: [lineSchema], default: [] },
    expiresAt: { type: Date, index: true },
  },
  options,
);
cartSchema.index(
  { businessId: 1, vendorId: 1, customerId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'active',
      customerId: { $exists: true },
    },
  },
);
cartSchema.index(
  { businessId: 1, vendorId: 1, anonymousKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'active',
      anonymousKey: { $exists: true },
    },
  },
);

export const vendorListingSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    variantKey: { type: String, required: true },
    title: { type: String, required: true },
    sku: String,
    price: money,
    compareAtPrice: Number,
    active: { type: Boolean, required: true, default: true },
    metadata: Schema.Types.Mixed,
  },
  options,
);
vendorListingSchema.index(
  { businessId: 1, vendorId: 1, variantKey: 1 },
  { unique: true },
);

export const orderSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    number: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, index: true },
    warehouseId: { type: Schema.Types.ObjectId, required: true, index: true },
    source: { type: String, required: true, default: 'website' },
    status: {
      type: String,
      required: true,
      enum: [
        'pending_payment',
        'paid',
        'processing',
        'partially_fulfilled',
        'fulfilled',
        'cancelled',
        'returned',
      ],
      default: 'pending_payment',
    },
    lines: { type: [lineSchema], required: true },
    shippingAddress: { type: addressSchema, required: true },
    subtotal: money,
    shippingAmount: money,
    discountAmount: money,
    grandTotal: money,
    paidAmount: { ...money, default: 0 },
    refundedAmount: { ...money, default: 0 },
    reservationExpiresAt: { type: Date, index: true },
    promotionCode: String,
    notes: String,
    statusHistory: {
      type: [{ status: String, at: Date, reason: String }],
      default: [],
    },
  },
  options,
);
orderSchema.index({ vendorId: 1, number: 1 }, { unique: true });

export const paymentSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    provider: { type: String, required: true },
    providerReference: String,
    idempotencyKey: { type: String, required: true },
    amount: money,
    capturedAmount: { ...money, default: 0 },
    refundedAmount: { ...money, default: 0 },
    status: {
      type: String,
      enum: [
        'pending',
        'authorized',
        'captured',
        'failed',
        'cancelled',
        'partially_refunded',
        'refunded',
      ],
      default: 'pending',
    },
    metadata: Schema.Types.Mixed,
  },
  options,
);
paymentSchema.index({ vendorId: 1, idempotencyKey: 1 }, { unique: true });

export const refundSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    paymentId: { type: Schema.Types.ObjectId, required: true, index: true },
    amount: money,
    idempotencyKey: { type: String, required: true },
    providerReference: String,
    reason: { type: String, required: true },
    status: { type: String, enum: ['confirmed'], default: 'confirmed' },
  },
  options,
);
refundSchema.index(
  { businessId: 1, vendorId: 1, idempotencyKey: 1 },
  { unique: true },
);

export const paymentWebhookSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    payloadHash: { type: String, required: true },
    payload: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
paymentWebhookSchema.index(
  { businessId: 1, vendorId: 1, provider: 1, eventId: 1 },
  { unique: true },
);

export const promotionSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    code: { type: String, required: true },
    type: { type: String, enum: ['fixed', 'percentage'], required: true },
    value: { type: Number, required: true, min: 1 },
    minimumSubtotal: { ...money, default: 0 },
    maximumDiscount: Number,
    startsAt: Date,
    endsAt: Date,
    usageLimit: Number,
    usageCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  options,
);
promotionSchema.index(
  { businessId: 1, vendorId: 1, code: 1 },
  { unique: true },
);

const shipmentLineSchema = new Schema(
  {
    variantKey: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

export const shipmentSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    warehouseId: { type: Schema.Types.ObjectId, required: true, index: true },
    status: {
      type: String,
      enum: [
        'pending',
        'packed',
        'shipped',
        'delivered',
        'cancelled',
        'returned',
      ],
      default: 'pending',
    },
    carrier: String,
    trackingCode: String,
    lines: { type: [shipmentLineSchema], required: true },
    statusHistory: { type: [{ status: String, at: Date }], default: [] },
  },
  options,
);

export const returnSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    status: {
      type: String,
      enum: [
        'requested',
        'approved',
        'rejected',
        'received',
        'refunded',
        'closed',
      ],
      default: 'requested',
    },
    reason: { type: String, required: true },
    notes: String,
    disposition: { type: String, enum: ['restock', 'damaged', 'none'] },
    lines: { type: [shipmentLineSchema], required: true },
    statusHistory: { type: [{ status: String, at: Date }], default: [] },
  },
  options,
);

export const channelMappingSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    channel: { type: String, required: true },
    accountKey: { type: String, required: true },
    variantKey: { type: String, required: true },
    remoteProductId: String,
    remoteVariantId: String,
    active: { type: Boolean, required: true, default: true },
  },
  options,
);
channelMappingSchema.index(
  { vendorId: 1, channel: 1, accountKey: 1, variantKey: 1 },
  { unique: true },
);

export const idempotencySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    scope: { type: String, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    resultId: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
idempotencySchema.index({ vendorId: 1, scope: 1, key: 1 }, { unique: true });

export const auditEventSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    action: { type: String, required: true },
    actor: String,
    data: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const outboxEventSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, index: true },
    topic: { type: String, required: true, index: true },
    aggregateType: { type: String, required: true },
    aggregateId: { type: Schema.Types.ObjectId, required: true },
    payload: Schema.Types.Mixed,
    attempts: { type: Number, required: true, default: 0 },
    availableAt: { type: Date, required: true, default: Date.now, index: true },
    processedAt: Date,
    lockedBy: String,
    lockedUntil: Date,
    lastError: String,
  },
  options,
);
outboxEventSchema.index({ processedAt: 1, availableAt: 1 });

export const schemaMetadataSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    version: { type: Number, required: true, min: 0 },
  },
  options,
);

export type CommerceModels = {
  Business: Model<InferSchemaType<typeof businessSchema>>;
  Vendor: Model<InferSchemaType<typeof vendorSchema>>;
  Warehouse: Model<InferSchemaType<typeof warehouseSchema>>;
  Inventory: Model<InferSchemaType<typeof inventorySchema>>;
  StockMovement: Model<InferSchemaType<typeof stockMovementSchema>>;
  Reservation: Model<InferSchemaType<typeof reservationSchema>>;
  StockTransfer: Model<InferSchemaType<typeof stockTransferSchema>>;
  Customer: Model<InferSchemaType<typeof customerSchema>>;
  Cart: Model<InferSchemaType<typeof cartSchema>>;
  VendorListing: Model<InferSchemaType<typeof vendorListingSchema>>;
  Order: Model<InferSchemaType<typeof orderSchema>>;
  Payment: Model<InferSchemaType<typeof paymentSchema>>;
  Refund: Model<InferSchemaType<typeof refundSchema>>;
  PaymentWebhook: Model<InferSchemaType<typeof paymentWebhookSchema>>;
  Promotion: Model<InferSchemaType<typeof promotionSchema>>;
  Shipment: Model<InferSchemaType<typeof shipmentSchema>>;
  Return: Model<InferSchemaType<typeof returnSchema>>;
  ChannelMapping: Model<InferSchemaType<typeof channelMappingSchema>>;
  Idempotency: Model<InferSchemaType<typeof idempotencySchema>>;
  AuditEvent: Model<InferSchemaType<typeof auditEventSchema>>;
  OutboxEvent: Model<InferSchemaType<typeof outboxEventSchema>>;
  SchemaMetadata: Model<InferSchemaType<typeof schemaMetadataSchema>>;
};

export function createCommerceModels(
  connection: Connection,
  prefix = 'Commerce',
  collectionPrefix = 'commerce_',
): CommerceModels {
  const model = <T>(name: string, schema: Schema<T>, collection: string) =>
    (connection.models[`${prefix}${name}`] as Model<T> | undefined) ??
    connection.model<T>(
      `${prefix}${name}`,
      schema,
      `${collectionPrefix}${collection}`,
    );

  return {
    Business: model('Business', businessSchema, 'businesses'),
    Vendor: model('Vendor', vendorSchema, 'vendors'),
    Warehouse: model('Warehouse', warehouseSchema, 'warehouses'),
    Inventory: model('Inventory', inventorySchema, 'inventory'),
    StockMovement: model(
      'StockMovement',
      stockMovementSchema,
      'stock_movements',
    ),
    Reservation: model('Reservation', reservationSchema, 'reservations'),
    StockTransfer: model(
      'StockTransfer',
      stockTransferSchema,
      'stock_transfers',
    ),
    Customer: model('Customer', customerSchema, 'customers'),
    Cart: model('Cart', cartSchema, 'carts'),
    VendorListing: model(
      'VendorListing',
      vendorListingSchema,
      'vendor_listings',
    ),
    Order: model('Order', orderSchema, 'orders'),
    Payment: model('Payment', paymentSchema, 'payments'),
    Refund: model('Refund', refundSchema, 'refunds'),
    PaymentWebhook: model(
      'PaymentWebhook',
      paymentWebhookSchema,
      'payment_webhooks',
    ),
    Promotion: model('Promotion', promotionSchema, 'promotions'),
    Shipment: model('Shipment', shipmentSchema, 'shipments'),
    Return: model('Return', returnSchema, 'returns'),
    ChannelMapping: model(
      'ChannelMapping',
      channelMappingSchema,
      'channel_mappings',
    ),
    Idempotency: model('Idempotency', idempotencySchema, 'idempotency'),
    AuditEvent: model('AuditEvent', auditEventSchema, 'audit_events'),
    OutboxEvent: model('OutboxEvent', outboxEventSchema, 'outbox_events'),
    SchemaMetadata: model(
      'SchemaMetadata',
      schemaMetadataSchema,
      'schema_metadata',
    ),
  };
}
