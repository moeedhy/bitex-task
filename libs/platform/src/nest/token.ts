import type { FactoryProvider } from '@nestjs/common';

declare const VALUE: unique symbol;

/**
 * An injection token that remembers what it resolves to.
 *
 * A `symbol` at runtime, so Nest sees an ordinary token and the value is a
 * legal `InjectionToken`. The phantom property carries the provided type
 * through the DI graph, which is what lets {@link provide} check a factory
 * against its declared dependencies.
 */
export type Token<Value> = symbol & { readonly [VALUE]: Value };

export function token<Value>(description: string): Token<Value> {
  return Symbol(description) as Token<Value>;
}

type Values<Tokens extends readonly unknown[]> = {
  [Index in keyof Tokens]: Tokens[Index] extends Token<infer Value>
    ? Value
    : never;
};

/**
 * A provider whose factory is checked against its own `inject` list.
 *
 * Nest's `useFactory` correlates a positional `inject: []` array with
 * positional factory parameters *by hand*. The composition root did this
 * thirty-one times, once with five entries; reordering either side, or changing
 * a token's type, was caught by nothing until the container resolved at runtime.
 *
 * `const D` preserves the tuple's element order, so `deps` and the factory's
 * parameters are one type relationship rather than two lists that happen to
 * agree. Swapping two dependencies is now a compile error.
 */
export function provide<
  Value,
  const Dependencies extends readonly Token<unknown>[],
>(
  target: Token<Value>,
  deps: Dependencies,
  useFactory: (...args: Values<Dependencies>) => Value | Promise<Value>,
): FactoryProvider<Value> {
  return {
    provide: target,
    inject: [...deps],
    useFactory: useFactory as FactoryProvider<Value>['useFactory'],
  };
}
