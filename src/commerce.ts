import { createHash, randomUUID } from 'node:crypto';
import { Types, type ClientSession, type Connection } from 'mongoose';
import {
  ChannelMappingInputSchema,
  CartIdentitySchema,
  CartLineMutationSchema,
  BusinessInputSchema,
  CheckoutInputSchema,
  CustomerInputSchema,
  PaymentAttemptInputSchema,
  ReturnInputSchema,
  ShipmentInputSchema,
  StockAdjustmentSchema,
  StockReservationSchema,
  VendorInputSchema,
  VendorListingInputSchema,
  WarehouseInputSchema,
  type OrderStatus,
  type PaymentStatus,
  type ReturnStatus,
  type ShipmentStatus,
} from './contracts.js';
import {
  CommerceError,
  InsufficientStockError,
  InvalidTransitionError,
} from './errors.js';
import { createCommerceModels, type CommerceModels } from './models.js';

export type CommerceMongooseOptions = {
  connection: Connection;
  modelPrefix?: string;
  collectionPrefix?: string;
  idempotencyTtlMs?: number;
  pricingProvider?: CommercePricingProvider;
};

export type CommercePricingQuote = {
  shippingAmount: number;
  discountAmount: number;
};

export type CommercePricingContext = {
  businessId: string;
  vendorId: string;
  warehouseId: string;
  customerId?: string;
  lines: ReadonlyArray<{
    variantKey: string;
    quantity: number;
    unitPrice: number;
  }>;
  shippingAddress: Record<string, unknown>;
};

export type CommercePricingProvider = {
  quote(context: CommercePricingContext): Promise<CommercePricingQuote>;
};

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function id(value: string) {
  if (!Types.ObjectId.isValid(value)) {
    throw new CommerceError('VALIDATION_FAILED', 'Invalid MongoDB ObjectId', {
      value,
    });
  }
  return new Types.ObjectId(value);
}

function transactionError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /Transaction numbers are only allowed|replica set|mongos/i.test(message)
  ) {
    throw new CommerceError(
      'TRANSACTION_REQUIRED',
      'Commerce mutations require MongoDB transactions. Configure a replica set, including a single-node replica set for small deployments.',
    );
  }
  throw error;
}

async function requireDocument<T>(promise: Promise<T | null>, entity: string) {
  const document = await promise;
  if (!document)
    throw new CommerceError('NOT_FOUND', `${entity} was not found`);
  return document;
}

const orderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['processing'],
  processing: ['partially_fulfilled', 'fulfilled'],
  partially_fulfilled: ['fulfilled'],
  fulfilled: ['returned'],
  cancelled: [],
  returned: [],
};

const paymentTransitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['authorized', 'captured', 'failed', 'cancelled'],
  authorized: ['captured', 'failed', 'cancelled'],
  captured: ['partially_refunded', 'refunded'],
  failed: [],
  cancelled: [],
  partially_refunded: ['partially_refunded', 'refunded'],
  refunded: [],
};

const shipmentTransitions: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  pending: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

const returnTransitions: Record<ReturnStatus, readonly ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['received', 'closed'],
  rejected: ['closed'],
  received: ['refunded', 'closed'],
  refunded: ['closed'],
  closed: [],
};

export class VendorCommerce {
  constructor(
    readonly businessId: string,
    readonly vendorId: string,
    private readonly root: CommerceMongoose,
  ) {}

  get models() {
    return this.root.models;
  }

  private get vendorObjectId() {
    return id(this.vendorId);
  }

  private get businessObjectId() {
    return id(this.businessId);
  }

  private async run<T>(work: (session: ClientSession) => Promise<T>) {
    return this.root.transaction(work);
  }

  private async assertVendor(session?: ClientSession) {
    const query = this.models.Vendor.exists({
      _id: this.vendorObjectId,
      businessId: this.businessObjectId,
      active: true,
    });
    if (session) query.session(session);
    if (!(await query)) {
      throw new CommerceError(
        'NOT_FOUND',
        'Active vendor was not found in this business',
      );
    }
  }

  readonly warehouses = {
    list: () =>
      this.models.Warehouse.find({
        businessId: this.businessObjectId,
        vendorIds: this.vendorObjectId,
      }),
  };

  readonly customers = {
    upsert: async (input: unknown) => {
      const parsed = CustomerInputSchema.parse(input);
      await this.assertVendor();
      return this.models.Customer.findOneAndUpdate(
        {
          businessId: this.businessObjectId,
          vendorId: this.vendorObjectId,
          phone: parsed.phone,
        },
        {
          $set: parsed,
          $setOnInsert: {
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
          },
        },
        { returnDocument: 'after', upsert: true, runValidators: true },
      );
    },
  };

  readonly catalog = {
    upsertListing: async (input: unknown) => {
      const parsed = VendorListingInputSchema.parse(input);
      await this.assertVendor();
      return this.models.VendorListing.findOneAndUpdate(
        {
          businessId: this.businessObjectId,
          vendorId: this.vendorObjectId,
          variantKey: parsed.variantKey,
        },
        {
          $set: parsed,
          $setOnInsert: {
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
          },
        },
        { returnDocument: 'after', upsert: true, runValidators: true },
      );
    },
    findListing: (variantKey: string) =>
      this.models.VendorListing.findOne({
        businessId: this.businessObjectId,
        vendorId: this.vendorObjectId,
        variantKey,
      }),
    listActive: () =>
      this.models.VendorListing.find({
        businessId: this.businessObjectId,
        vendorId: this.vendorObjectId,
        active: true,
      }),
  };

  readonly carts = {
    getOrCreate: async (input: unknown) => {
      const parsed = CartIdentitySchema.parse(input);
      await this.assertVendor();
      const identity = parsed.customerId
        ? { customerId: id(parsed.customerId) }
        : { anonymousKey: parsed.anonymousKey };
      return this.models.Cart.findOneAndUpdate(
        {
          businessId: this.businessObjectId,
          vendorId: this.vendorObjectId,
          status: 'active',
          ...identity,
        },
        {
          $setOnInsert: {
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
            status: 'active',
            lines: [],
            ...identity,
          },
          ...(parsed.expiresAt
            ? { $set: { expiresAt: parsed.expiresAt } }
            : {}),
        },
        { returnDocument: 'after', upsert: true, runValidators: true },
      );
    },
    setLine: async (input: unknown) => {
      const parsed = CartLineMutationSchema.parse(input);
      await this.assertVendor();
      const cart = await requireDocument(
        this.models.Cart.findOne({
          _id: id(parsed.cartId),
          businessId: this.businessObjectId,
          vendorId: this.vendorObjectId,
          status: 'active',
        }).exec(),
        'Active cart',
      );
      const current = cart.lines.findIndex(
        (line) => line.variantKey === parsed.variantKey,
      );
      if (parsed.quantity === 0) {
        if (current >= 0) cart.lines.splice(current, 1);
      } else {
        const listing = await requireDocument(
          this.models.VendorListing.findOne({
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
            variantKey: parsed.variantKey,
            active: true,
          }).exec(),
          'Vendor listing',
        );
        const line = {
          variantKey: listing.variantKey,
          sku: listing.sku,
          title: listing.title,
          quantity: parsed.quantity,
          unitPrice: listing.price,
          lineTotal: listing.price * parsed.quantity,
          metadata: listing.metadata,
        };
        if (current >= 0)
          cart.lines.splice(current, 1, cart.lines.create(line));
        else cart.lines.push(line);
      }
      await cart.save();
      return cart;
    },
  };

  private async mutateStock(
    input: {
      warehouseId: string;
      variantKey: string;
      onHandDelta: number;
      reservedDelta: number;
      reason: string;
      type: 'adjustment' | 'reservation' | 'release' | 'sale' | 'return';
      orderId?: string;
      reference?: string;
    },
    session: ClientSession,
  ) {
    await this.assertVendor(session);
    const warehouseId = id(input.warehouseId);
    await requireDocument(
      this.models.Warehouse.findOne({
        _id: warehouseId,
        businessId: this.businessObjectId,
        vendorIds: this.vendorObjectId,
        active: true,
      })
        .session(session)
        .exec(),
      'Warehouse',
    );
    const filter: Record<string, unknown> = {
      businessId: this.businessObjectId,
      warehouseId,
      variantKey: input.variantKey,
    };
    if (input.onHandDelta < 0) {
      filter.onHand = { $gte: -input.onHandDelta };
    }
    if (input.reservedDelta > 0) {
      filter.$expr = {
        $gte: [{ $subtract: ['$onHand', '$reserved'] }, input.reservedDelta],
      };
    } else if (input.reservedDelta < 0) {
      filter.reserved = { $gte: -input.reservedDelta };
    }

    const inventory = await this.models.Inventory.findOneAndUpdate(
      filter,
      {
        $inc: {
          onHand: input.onHandDelta,
          reserved: input.reservedDelta,
        },
        $setOnInsert: { businessId: this.businessObjectId },
      },
      {
        returnDocument: 'after',
        upsert: input.type === 'adjustment' && input.onHandDelta > 0,
        runValidators: true,
        session,
      },
    );
    if (!inventory) {
      throw new InsufficientStockError(
        input.variantKey,
        Math.max(-input.onHandDelta, input.reservedDelta),
      );
    }
    await this.models.StockMovement.create(
      [
        {
          businessId: this.businessObjectId,
          vendorId: this.vendorObjectId,
          warehouseId,
          variantKey: input.variantKey,
          ...(input.orderId ? { orderId: id(input.orderId) } : {}),
          type: input.type,
          onHandDelta: input.onHandDelta,
          reservedDelta: input.reservedDelta,
          reason: input.reason,
          reference: input.reference,
        },
      ],
      { session },
    );
    return inventory;
  }

  readonly inventory = {
    get: (warehouseId: string, variantKey: string) =>
      this.models.Inventory.findOne({
        businessId: this.businessObjectId,
        warehouseId: id(warehouseId),
        variantKey,
      }),
    adjust: async (input: unknown) => {
      const parsed = StockAdjustmentSchema.parse(input);
      return this.run((session) =>
        this.mutateStock(
          {
            ...parsed,
            onHandDelta: parsed.quantity,
            reservedDelta: 0,
            type: 'adjustment',
          },
          session,
        ),
      );
    },
    reserve: async (input: unknown) => {
      const parsed = StockReservationSchema.parse(input);
      return this.run((session) =>
        this.mutateStock(
          {
            ...parsed,
            onHandDelta: 0,
            reservedDelta: parsed.quantity,
            type: 'reservation',
            reason: 'order reservation',
          },
          session,
        ),
      );
    },
  };

  readonly orders = {
    checkout: async (input: unknown) => {
      const parsed = CheckoutInputSchema.parse(input);
      const requestHash = hash(parsed);
      return this.run(async (session) => {
        const existing = await this.models.Idempotency.findOne({
          businessId: this.businessObjectId,
          vendorId: this.vendorObjectId,
          scope: 'checkout',
          key: parsed.idempotencyKey,
        }).session(session);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new CommerceError(
              'IDEMPOTENCY_CONFLICT',
              'This checkout key was already used with different input',
            );
          }
          return requireDocument(
            this.models.Order.findOne({
              _id: existing.resultId,
              businessId: this.businessObjectId,
              vendorId: this.vendorObjectId,
            })
              .session(session)
              .exec(),
            'Order',
          );
        }

        const lines = await Promise.all(
          parsed.lines.map(async (line) => {
            const listing = await requireDocument(
              this.models.VendorListing.findOne({
                businessId: this.businessObjectId,
                vendorId: this.vendorObjectId,
                variantKey: line.variantKey,
                active: true,
              })
                .session(session)
                .exec(),
              'Vendor listing',
            );
            return {
              variantKey: line.variantKey,
              sku: listing.sku,
              title: listing.title,
              quantity: line.quantity,
              unitPrice: listing.price,
              lineTotal: listing.price * line.quantity,
              metadata: listing.metadata,
            };
          }),
        );
        const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
        const quote = this.root.options.pricingProvider
          ? await this.root.options.pricingProvider.quote({
              businessId: this.businessId,
              vendorId: this.vendorId,
              warehouseId: parsed.warehouseId,
              customerId: parsed.customerId,
              lines: lines.map(({ variantKey, quantity, unitPrice }) => ({
                variantKey,
                quantity,
                unitPrice,
              })),
              shippingAddress: parsed.shippingAddress,
            })
          : { shippingAmount: 0, discountAmount: 0 };
        if (
          !Number.isSafeInteger(quote.shippingAmount) ||
          quote.shippingAmount < 0 ||
          !Number.isSafeInteger(quote.discountAmount) ||
          quote.discountAmount < 0
        ) {
          throw new CommerceError(
            'VALIDATION_FAILED',
            'Pricing provider must return non-negative integer rial amounts',
          );
        }
        const grandTotal =
          subtotal + quote.shippingAmount - quote.discountAmount;
        if (grandTotal < 0) {
          throw new CommerceError(
            'VALIDATION_FAILED',
            'Discount cannot exceed the order total',
          );
        }
        const [order] = await this.models.Order.create(
          [
            {
              businessId: this.businessObjectId,
              vendorId: this.vendorObjectId,
              number: randomUUID(),
              customerId: parsed.customerId ? id(parsed.customerId) : undefined,
              warehouseId: id(parsed.warehouseId),
              source: parsed.source,
              status: 'pending_payment',
              lines,
              shippingAddress: parsed.shippingAddress,
              subtotal,
              shippingAmount: quote.shippingAmount,
              discountAmount: quote.discountAmount,
              grandTotal,
              notes: parsed.notes,
              statusHistory: [{ status: 'pending_payment', at: new Date() }],
            },
          ],
          { session },
        );
        if (!order) throw new Error('MongoDB did not return the created order');

        for (const line of lines) {
          await this.mutateStock(
            {
              warehouseId: parsed.warehouseId,
              variantKey: line.variantKey,
              onHandDelta: 0,
              reservedDelta: line.quantity,
              type: 'reservation',
              reason: 'checkout',
              orderId: String(order._id),
            },
            session,
          );
        }
        await this.models.Idempotency.create(
          [
            {
              businessId: this.businessObjectId,
              vendorId: this.vendorObjectId,
              scope: 'checkout',
              key: parsed.idempotencyKey,
              requestHash,
              resultId: order._id,
              expiresAt: new Date(Date.now() + this.root.idempotencyTtlMs),
            },
          ],
          { session },
        );
        await this.root.audit(
          this.businessObjectId,
          this.vendorObjectId,
          'order',
          order._id,
          'checkout.created',
          session,
        );
        return order;
      });
    },
    transition: (orderId: string, to: OrderStatus, reason?: string) =>
      this.run(async (session) => {
        const order = await requireDocument(
          this.models.Order.findOne({
            _id: id(orderId),
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
          })
            .session(session)
            .exec(),
          'Order',
        );
        const from = order.status as OrderStatus;
        if (!orderTransitions[from].includes(to)) {
          throw new InvalidTransitionError('order', from, to);
        }
        if (to === 'cancelled') {
          for (const line of order.lines) {
            await this.mutateStock(
              {
                warehouseId: String(order.warehouseId),
                variantKey: line.variantKey,
                onHandDelta: 0,
                reservedDelta: -line.quantity,
                type: 'release',
                reason: reason ?? 'order cancelled',
                orderId,
              },
              session,
            );
          }
        }
        order.status = to;
        order.statusHistory.push({ status: to, at: new Date(), reason });
        await order.save({ session });
        return order;
      }),
  };

  readonly payments = {
    createAttempt: async (input: unknown) => {
      const parsed = PaymentAttemptInputSchema.parse(input);
      return this.run(async (session) => {
        const order = await requireDocument(
          this.models.Order.findOne({
            _id: id(parsed.orderId),
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
          })
            .session(session)
            .exec(),
          'Order',
        );
        const outstanding = order.grandTotal - order.paidAmount;
        if (parsed.amount !== outstanding) {
          throw new CommerceError(
            'VALIDATION_FAILED',
            `Payment amount must equal the outstanding order total (${outstanding})`,
          );
        }
        const [payment] = await this.models.Payment.create(
          [
            {
              ...parsed,
              businessId: this.businessObjectId,
              vendorId: this.vendorObjectId,
              orderId: id(parsed.orderId),
            },
          ],
          { session },
        );
        return payment;
      });
    },
    transition: (paymentId: string, to: PaymentStatus) =>
      this.run(async (session) => {
        const payment = await requireDocument(
          this.models.Payment.findOne({
            _id: id(paymentId),
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
          })
            .session(session)
            .exec(),
          'Payment',
        );
        const from = payment.status as PaymentStatus;
        if (!paymentTransitions[from].includes(to)) {
          throw new InvalidTransitionError('payment', from, to);
        }
        payment.status = to;
        if (to === 'captured') {
          const order = await requireDocument(
            this.models.Order.findOne({
              _id: payment.orderId,
              businessId: this.businessObjectId,
              vendorId: this.vendorObjectId,
              status: 'pending_payment',
            })
              .session(session)
              .exec(),
            'Payable order',
          );
          for (const line of order.lines) {
            await this.mutateStock(
              {
                warehouseId: String(order.warehouseId),
                variantKey: line.variantKey,
                onHandDelta: -line.quantity,
                reservedDelta: -line.quantity,
                type: 'sale',
                reason: 'payment captured',
                orderId: String(order._id),
              },
              session,
            );
          }
          payment.capturedAmount = payment.amount;
          order.paidAmount += payment.amount;
          order.status = 'paid';
          order.statusHistory.push({ status: 'paid', at: new Date() });
          await order.save({ session });
        }
        await payment.save({ session });
        return payment;
      }),
  };

  readonly fulfillment = {
    createShipment: async (input: unknown) => {
      const parsed = ShipmentInputSchema.parse(input);
      return this.run(async (session) => {
        const order = await requireDocument(
          this.models.Order.findOne({
            _id: id(parsed.orderId),
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
            status: { $in: ['paid', 'processing', 'partially_fulfilled'] },
          })
            .session(session)
            .exec(),
          'Order',
        );
        if (String(order.warehouseId) !== parsed.warehouseId) {
          throw new CommerceError(
            'VALIDATION_FAILED',
            'Shipment warehouse must match the order warehouse',
          );
        }
        const existing = await this.models.Shipment.find({
          businessId: this.businessObjectId,
          vendorId: this.vendorObjectId,
          orderId: order._id,
          status: { $ne: 'cancelled' },
        }).session(session);
        for (const line of parsed.lines) {
          const ordered = order.lines.find(
            (item) => item.variantKey === line.variantKey,
          )?.quantity;
          const alreadyShipped = existing.reduce(
            (sum, shipment) =>
              sum +
              (shipment.lines.find(
                (item) => item.variantKey === line.variantKey,
              )?.quantity ?? 0),
            0,
          );
          if (
            ordered === undefined ||
            alreadyShipped + line.quantity > ordered
          ) {
            throw new CommerceError(
              'VALIDATION_FAILED',
              `Shipment exceeds ordered quantity for ${line.variantKey}`,
            );
          }
        }
        const [shipment] = await this.models.Shipment.create(
          [
            {
              ...parsed,
              businessId: this.businessObjectId,
              vendorId: this.vendorObjectId,
              orderId: id(parsed.orderId),
              warehouseId: id(parsed.warehouseId),
              statusHistory: [{ status: 'pending', at: new Date() }],
            },
          ],
          { session },
        );
        return shipment;
      });
    },
    transition: (shipmentId: string, to: ShipmentStatus) =>
      this.run(async (session) => {
        const shipment = await requireDocument(
          this.models.Shipment.findOne({
            _id: id(shipmentId),
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
          })
            .session(session)
            .exec(),
          'Shipment',
        );
        const from = shipment.status as ShipmentStatus;
        if (!shipmentTransitions[from].includes(to)) {
          throw new InvalidTransitionError('shipment', from, to);
        }
        shipment.status = to;
        shipment.statusHistory.push({ status: to, at: new Date() });
        await shipment.save({ session });
        return shipment;
      }),
  };

  readonly returns = {
    create: async (input: unknown) => {
      const parsed = ReturnInputSchema.parse(input);
      return this.run(async (session) => {
        const order = await requireDocument(
          this.models.Order.findOne({
            _id: id(parsed.orderId),
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
            status: { $in: ['fulfilled', 'returned'] },
          })
            .session(session)
            .exec(),
          'Order',
        );
        const existing = await this.models.Return.find({
          businessId: this.businessObjectId,
          vendorId: this.vendorObjectId,
          orderId: order._id,
          status: { $nin: ['rejected', 'closed'] },
        }).session(session);
        for (const line of parsed.lines) {
          const ordered = order.lines.find(
            (item) => item.variantKey === line.variantKey,
          )?.quantity;
          const alreadyRequested = existing.reduce(
            (sum, item) =>
              sum +
              (item.lines.find(
                (existingLine) => existingLine.variantKey === line.variantKey,
              )?.quantity ?? 0),
            0,
          );
          if (
            ordered === undefined ||
            alreadyRequested + line.quantity > ordered
          ) {
            throw new CommerceError(
              'VALIDATION_FAILED',
              `Return exceeds ordered quantity for ${line.variantKey}`,
            );
          }
        }
        const [result] = await this.models.Return.create(
          [
            {
              ...parsed,
              businessId: this.businessObjectId,
              vendorId: this.vendorObjectId,
              orderId: id(parsed.orderId),
              statusHistory: [{ status: 'requested', at: new Date() }],
            },
          ],
          { session },
        );
        return result;
      });
    },
    transition: (returnId: string, to: ReturnStatus) =>
      this.run(async (session) => {
        const result = await requireDocument(
          this.models.Return.findOne({
            _id: id(returnId),
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
          })
            .session(session)
            .exec(),
          'Return',
        );
        const from = result.status as ReturnStatus;
        if (!returnTransitions[from].includes(to)) {
          throw new InvalidTransitionError('return', from, to);
        }
        if (to === 'received') {
          const order = await requireDocument(
            this.models.Order.findOne({
              _id: result.orderId,
              businessId: this.businessObjectId,
              vendorId: this.vendorObjectId,
            })
              .session(session)
              .exec(),
            'Order',
          );
          for (const line of result.lines) {
            await this.mutateStock(
              {
                warehouseId: String(order.warehouseId),
                variantKey: line.variantKey,
                onHandDelta: line.quantity,
                reservedDelta: 0,
                type: 'return',
                reason: 'return received',
                orderId: String(order._id),
              },
              session,
            );
          }
        }
        result.status = to;
        result.statusHistory.push({ status: to, at: new Date() });
        await result.save({ session });
        return result;
      }),
  };

  readonly channels = {
    upsert: async (input: unknown) => {
      const parsed = ChannelMappingInputSchema.parse(input);
      await this.assertVendor();
      return this.models.ChannelMapping.findOneAndUpdate(
        {
          businessId: this.businessObjectId,
          vendorId: this.vendorObjectId,
          channel: parsed.channel,
          accountKey: parsed.accountKey,
          variantKey: parsed.variantKey,
        },
        {
          $set: parsed,
          $setOnInsert: {
            businessId: this.businessObjectId,
            vendorId: this.vendorObjectId,
          },
        },
        { returnDocument: 'after', upsert: true, runValidators: true },
      );
    },
  };
}

export class BusinessCommerce {
  constructor(
    readonly businessId: string,
    private readonly root: CommerceMongoose,
  ) {}

  private get businessObjectId() {
    return id(this.businessId);
  }

  readonly vendors = {
    create: async (input: unknown) =>
      this.root.models.Vendor.create({
        ...VendorInputSchema.parse(input),
        businessId: this.businessObjectId,
      }),
    findByKey: (key: string) =>
      this.root.models.Vendor.findOne({
        businessId: this.businessObjectId,
        key,
      }),
    list: () =>
      this.root.models.Vendor.find({ businessId: this.businessObjectId }),
  };

  readonly warehouses = {
    create: async (input: unknown) => {
      const parsed = WarehouseInputSchema.parse(input);
      const vendorIds = parsed.vendorIds.map(id);
      const matched = await this.root.models.Vendor.countDocuments({
        _id: { $in: vendorIds },
        businessId: this.businessObjectId,
      });
      if (matched !== vendorIds.length) {
        throw new CommerceError(
          'VALIDATION_FAILED',
          'Every warehouse vendor must belong to this business',
        );
      }
      return this.root.models.Warehouse.create({
        ...parsed,
        businessId: this.businessObjectId,
        vendorIds,
      });
    },
    list: () =>
      this.root.models.Warehouse.find({ businessId: this.businessObjectId }),
  };

  forVendor(vendorId: string) {
    return new VendorCommerce(this.businessId, vendorId, this.root);
  }
}

export class CommerceMongoose {
  readonly models: CommerceModels;
  readonly idempotencyTtlMs: number;

  constructor(readonly options: CommerceMongooseOptions) {
    this.models = createCommerceModels(
      options.connection,
      options.modelPrefix,
      options.collectionPrefix,
    );
    this.idempotencyTtlMs = options.idempotencyTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  readonly businesses = {
    create: async (input: unknown) =>
      this.models.Business.create(BusinessInputSchema.parse(input)),
    findByKey: (key: string) => this.models.Business.findOne({ key }),
  };

  forBusiness(businessId: string) {
    return new BusinessCommerce(businessId, this);
  }

  forVendor(scope: { businessId: string; vendorId: string }) {
    return new VendorCommerce(scope.businessId, scope.vendorId, this);
  }

  async ensureIndexes() {
    await Promise.all(
      Object.values(this.models).map((model) => model.createIndexes()),
    );
  }

  async transaction<T>(work: (session: ClientSession) => Promise<T>) {
    const session = await this.options.connection.startSession();
    try {
      return await session.withTransaction(() => work(session));
    } catch (error) {
      return transactionError(error);
    } finally {
      await session.endSession();
    }
  }

  async audit(
    businessId: Types.ObjectId,
    vendorId: Types.ObjectId,
    entityType: string,
    entityId: Types.ObjectId,
    action: string,
    session: ClientSession,
    data?: Record<string, unknown>,
  ) {
    await this.models.AuditEvent.create(
      [{ businessId, vendorId, entityType, entityId, action, data }],
      { session },
    );
  }
}

export function createCommerceMongoose(options: CommerceMongooseOptions) {
  return new CommerceMongoose(options);
}
