import { Module } from '@nestjs/common';
import type { DynamicModule, ModuleMetadata } from '@nestjs/common';
import { uuidV7Generator } from '@bitex/platform';
import { CLOCK, OUTBOX, provide, TRANSACTION_RUNNER } from '@bitex/platform/nest';
import { ExecuteWithdrawal } from '../application/execute-withdrawal/execute-withdrawal.js';
import { GetWithdrawal } from '../application/get-withdrawal/get-withdrawal.js';
import { RecoverStuckWithdrawals } from '../application/recover-stuck-withdrawals/recover-stuck-withdrawals.js';
import { RequestWithdrawal } from '../application/request-withdrawal/request-withdrawal.js';
import {
  EVENT_ID_GENERATOR,
  EXECUTE_WITHDRAWAL,
  GET_WITHDRAWAL,
  PROCESSED_EVENTS,
  RECOVER_STUCK_WITHDRAWALS,
  REQUEST_WITHDRAWAL,
  STUCK_WITHDRAWAL_QUERY,
  WALLET_RESERVATION,
  WALLET_SETTLEMENT,
  WITHDRAWAL_ID_GENERATOR,
  WITHDRAWAL_IDEMPOTENCY,
  WITHDRAWAL_PROVIDER,
  WITHDRAWAL_QUERY,
  WITHDRAWAL_RECOVERY_OPTIONS,
  WITHDRAWAL_REPOSITORY,
} from './withdrawal.tokens.js';

export interface WithdrawalModuleOptions {
  /**
   * Modules exporting this context's adapter tokens, plus
   * {@link WITHDRAWAL_RECOVERY_OPTIONS}. Which database, which broker and which
   * provider are all the application's choices.
   */
  imports: NonNullable<ModuleMetadata['imports']>;
}

/**
 * The Withdrawal context wires itself.
 *
 * Every dependency is a token, so this module states its requirements rather
 * than reaching for implementations. The application supplies PostgreSQL
 * adapters; a test supplies fakes; neither is visible from here.
 *
 * Note the two id generators. They are separate tokens because `IdGenerator` is
 * typed by the identity it mints: handing the withdrawal generator to the event
 * slot is a compile error, where previously both slots received the same object
 * under two names and nothing noticed.
 */
@Module({})
export class WithdrawalModule {
  static forRoot(options: WithdrawalModuleOptions): DynamicModule {
    return {
      module: WithdrawalModule,
      imports: options.imports,
      providers: [
        provide(WITHDRAWAL_ID_GENERATOR, [], () =>
          uuidV7Generator<'WithdrawalId'>(),
        ),
        provide(EVENT_ID_GENERATOR, [], () => uuidV7Generator<'EventId'>()),
        provide(
          REQUEST_WITHDRAWAL,
          [
            TRANSACTION_RUNNER,
            WITHDRAWAL_IDEMPOTENCY,
            WALLET_RESERVATION,
            WITHDRAWAL_REPOSITORY,
            OUTBOX,
            WITHDRAWAL_ID_GENERATOR,
            EVENT_ID_GENERATOR,
            CLOCK,
          ],
          (
            transactionRunner,
            idempotency,
            walletReservation,
            withdrawals,
            outbox,
            withdrawalIdGenerator,
            eventIdGenerator,
            clock,
          ) =>
            new RequestWithdrawal({
              transactionRunner,
              idempotency,
              walletReservation,
              withdrawals,
              outbox,
              withdrawalIdGenerator,
              eventIdGenerator,
              clock,
            }),
        ),
        provide(
          EXECUTE_WITHDRAWAL,
          [
            TRANSACTION_RUNNER,
            WITHDRAWAL_REPOSITORY,
            PROCESSED_EVENTS,
            WALLET_SETTLEMENT,
            WITHDRAWAL_PROVIDER,
            CLOCK,
          ],
          (
            transactionRunner,
            withdrawals,
            processedEvents,
            walletSettlement,
            provider,
            clock,
          ) =>
            new ExecuteWithdrawal({
              transactionRunner,
              withdrawals,
              processedEvents,
              walletSettlement,
              provider,
              clock,
            }),
        ),
        provide(
          RECOVER_STUCK_WITHDRAWALS,
          [
            TRANSACTION_RUNNER,
            STUCK_WITHDRAWAL_QUERY,
            OUTBOX,
            EVENT_ID_GENERATOR,
            CLOCK,
            WITHDRAWAL_RECOVERY_OPTIONS,
          ],
          (
            transactionRunner,
            stuckWithdrawals,
            outbox,
            eventIdGenerator,
            clock,
            recovery,
          ) =>
            new RecoverStuckWithdrawals({
              transactionRunner,
              stuckWithdrawals,
              outbox,
              eventIdGenerator,
              clock,
              processingTimeoutMs: recovery.processingTimeoutMs,
              batchSize: recovery.batchSize,
            }),
        ),
        provide(
          GET_WITHDRAWAL,
          [WITHDRAWAL_QUERY],
          (query) => new GetWithdrawal(query),
        ),
      ],
      exports: [
        REQUEST_WITHDRAWAL,
        EXECUTE_WITHDRAWAL,
        GET_WITHDRAWAL,
        RECOVER_STUCK_WITHDRAWALS,
      ],
    };
  }
}
