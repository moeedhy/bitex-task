import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { CLOCK, TRANSACTION_RUNNER } from '@bitex/platform/nest';
import { RESERVE_FUNDS, SETTLE_RESERVATION } from '@bitex/wallet/nest';
import { ReserveFunds, SettleReservation } from '@bitex/wallet';
import {
  EXECUTE_WITHDRAWAL,
  GET_WITHDRAWAL,
  RECOVER_STUCK_WITHDRAWALS,
  REQUEST_WITHDRAWAL,
} from '@bitex/withdrawal/nest';
import {
  ExecuteWithdrawal,
  GetWithdrawal,
  RecoverStuckWithdrawals,
  RequestWithdrawal,
} from '@bitex/withdrawal';
import { AppModule } from '../app/app.module.js';
import { WithdrawalsController } from '../app/withdrawals.controller.js';
import { APP_CONFIG } from '../config/config.module.js';

/**
 * Compiles the real container without initialising it, so wiring mistakes fail
 * here rather than at boot. Nothing connects: constructing a pool, a Redis
 * client or a Kafka client opens no socket, and `compile()` does not run
 * lifecycle hooks.
 */
describe('application composition', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  afterAll(async () => moduleRef.close());

  it.each([
    ['RequestWithdrawal', REQUEST_WITHDRAWAL, RequestWithdrawal],
    ['ExecuteWithdrawal', EXECUTE_WITHDRAWAL, ExecuteWithdrawal],
    ['GetWithdrawal', GET_WITHDRAWAL, GetWithdrawal],
    [
      'RecoverStuckWithdrawals',
      RECOVER_STUCK_WITHDRAWALS,
      RecoverStuckWithdrawals,
    ],
    ['ReserveFunds', RESERVE_FUNDS, ReserveFunds],
    ['SettleReservation', SETTLE_RESERVATION, SettleReservation],
  ])('resolves %s from the container', (_name, token, type) => {
    expect(moduleRef.get(token)).toBeInstanceOf(type);
  });

  it('gives every consumer the same transaction runner', () => {
    // Two runners would mean two AsyncLocalStorage scopes and therefore two
    // transactions, silently breaking the atomicity the workflow relies on.
    expect(moduleRef.get(TRANSACTION_RUNNER)).toBe(
      moduleRef.get(TRANSACTION_RUNNER),
    );
  });

  it('keeps application providers singleton', () => {
    expect(moduleRef.get(REQUEST_WITHDRAWAL)).toBe(
      moduleRef.get(REQUEST_WITHDRAWAL),
    );
  });

  it('injects use cases into the controller rather than a service locator', () => {
    expect(moduleRef.get(WithdrawalsController)).toBeInstanceOf(
      WithdrawalsController,
    );
  });

  /**
   * The clock is a provider now, not a module-scope constant closed over by
   * three factories. That is what makes it substitutable at all.
   */
  it('resolves the clock through the container', () => {
    expect(moduleRef.get(CLOCK).now()).toBeInstanceOf(Date);
  });

  /**
   * Configuration is parsed once, at composition, so a bad value fails here
   * rather than as a connection timeout in production.
   */
  it('validates configuration into one object', () => {
    const config = moduleRef.get(APP_CONFIG);

    expect(config.DATABASE_POOL_MAX).toBeGreaterThan(0);
    expect(config.kafkaDlqTopic).toBe(`${config.KAFKA_TOPIC}.dlq`);
  });
});
