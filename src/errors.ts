export type CommerceErrorCode =
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NOT_FOUND'
  | 'TRANSACTION_REQUIRED'
  | 'VALIDATION_FAILED';

export class CommerceError extends Error {
  constructor(
    readonly code: CommerceErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}

export class InsufficientStockError extends CommerceError {
  constructor(variantKey: string, requested: number) {
    super('INSUFFICIENT_STOCK', `Insufficient stock for ${variantKey}`, {
      variantKey,
      requested,
    });
    this.name = 'InsufficientStockError';
  }
}

export class InvalidTransitionError extends CommerceError {
  constructor(entity: string, from: string, to: string) {
    super(
      'INVALID_TRANSITION',
      `Cannot transition ${entity} from ${from} to ${to}`,
      {
        entity,
        from,
        to,
      },
    );
    this.name = 'InvalidTransitionError';
  }
}
