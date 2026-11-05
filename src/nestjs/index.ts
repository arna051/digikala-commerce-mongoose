import {
  Module,
  type DynamicModule,
  type InjectionToken,
  type OptionalFactoryDependency,
  type Provider,
} from '@nestjs/common';
import {
  createCommerceMongoose,
  type CommerceMongoose,
  type CommerceMongooseOptions,
} from '../commerce.js';

export const COMMERCE_MONGOOSE = Symbol('COMMERCE_MONGOOSE');

export type CommerceModuleAsyncOptions = {
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  global?: boolean;
  useFactory: (
    ...dependencies: unknown[]
  ) => CommerceMongooseOptions | Promise<CommerceMongooseOptions>;
};

@Module({})
export class DigikalaCommerceModule {
  static forRoot(
    options: CommerceMongooseOptions,
    moduleOptions: { global?: boolean } = {},
  ): DynamicModule {
    const provider: Provider<CommerceMongoose> = {
      provide: COMMERCE_MONGOOSE,
      useFactory: async () => {
        const commerce = createCommerceMongoose(options);
        await commerce.ensureReady();
        return commerce;
      },
    };
    return {
      module: DigikalaCommerceModule,
      global: moduleOptions.global,
      providers: [provider],
      exports: [provider],
    };
  }

  static forRootAsync(options: CommerceModuleAsyncOptions): DynamicModule {
    const provider: Provider<CommerceMongoose> = {
      provide: COMMERCE_MONGOOSE,
      inject: options.inject ?? [],
      useFactory: async (...dependencies: unknown[]) => {
        const commerce = createCommerceMongoose(
          await options.useFactory(...dependencies),
        );
        await commerce.ensureReady();
        return commerce;
      },
    };
    return {
      module: DigikalaCommerceModule,
      global: options.global,
      providers: [provider],
      exports: [provider],
    };
  }
}
