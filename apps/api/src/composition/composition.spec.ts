import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import {
  ExecuteWithdrawal,
  GetWithdrawal,
  RecoverStuckWithdrawals,
  RequestWithdrawal,
} from '@bitex/withdrawal';
import {
  SettleReservation,
  ReserveFunds,
} from '@bitex/wallet';
import { AppModule } from '../app/app.module.js';
import { WithdrawalsController } from '../app/withdrawals.controller.js';
import { PostgresTransactionRunner } from '../infrastructure/shared/postgres-transaction-runner.js';
import { RedisRateLimiter } from '../infrastructure/redis/redis-rate-limiter.js';

/**
 * Compiles the real container without initialising it, so wiring mistakes fail
 * here rather than at boot. Nothing connects: constructing a pool, a Redis
 * client or a Kafka client opens no socket, and `compile()` does not run
 * lifecycle hooks.
 */
describe('application composition', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => moduleRef.close());

  it.each([
    ['RequestWithdrawal', RequestWithdrawal],
    ['ExecuteWithdrawal', ExecuteWithdrawal],
    ['GetWithdrawal', GetWithdrawal],
    ['RecoverStuckWithdrawals', RecoverStuckWithdrawals],
    ['ReserveFunds', ReserveFunds],
    ['SettleReservation', SettleReservation],
  ])('resolves %s from the container', (_name, token) => {
    expect(moduleRef.get(token)).toBeInstanceOf(token);
  });

  it('gives every consumer the same transaction runner', () => {
    // Two runners would mean two AsyncLocalStorage scopes and therefore two
    // transactions, silently breaking the atomicity the workflow relies on.
    expect(moduleRef.get(PostgresTransactionRunner)).toBe(
      moduleRef.get(PostgresTransactionRunner),
    );
  });

  it('keeps application providers singleton', () => {
    expect(moduleRef.get(RequestWithdrawal)).toBe(
      moduleRef.get(RequestWithdrawal),
    );
  });

  it('injects use cases into the controller rather than a service locator', () => {
    const controller = moduleRef.get(WithdrawalsController);

    expect(controller).toBeInstanceOf(WithdrawalsController);
    expect(moduleRef.get(RedisRateLimiter)).toBeInstanceOf(RedisRateLimiter);
  });
});
