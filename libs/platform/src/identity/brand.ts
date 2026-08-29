export type Brand<Value, Name> = Value & {
  readonly __brand: Name;
};
