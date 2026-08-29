import { assertNever } from '@bitex/platform';
import type {
  Clock,
  IdGenerator,
  Money,
  Outbox,
  ReservationId,
  TransactionRunner,
  UserId,
  WithdrawalId,
} from '@bitex/platform';
import { Withdrawal } from '../../domain/withdrawal.js';
import type { WithdrawalStatus } from '../../domain/withdrawal-status.js';
import { IdempotencyKeyConflictError } from '../withdrawal.errors.js';
import type { WithdrawalRepository } from '../ports/withdrawal.repository.js';
import { createRequestFingerprint } from './request-fingerprint.js';

/**
 * `amount` carries its own `Asset`, so the command deliberately has no separate
 * asset field: a command whose asset disagrees with its amount cannot be
 * represented.
 */
export interface RequestWithdrawalCommand {
  idempotencyKey: string;
  userId: UserId;
  amount: Money;
  destinationAddress: string;
}

export interface RequestWithdrawalResult {
  withdrawalId: WithdrawalId;
  status: WithdrawalStatus;
  asset: string;
  amount: string;
}

export interface WalletReservationPort {
  reserve(input: {
    withdrawalId: WithdrawalId;
    userId: UserId;
    amount: Money;
  }): Promise<{ reservationId: ReservationId }>;
}

/**
 * Three outcomes, all of them expected protocol results rather than failures.
 * `CONFLICT` is a return value, not an adapter-thrown exception, so the
 * workflow — not whichever storage happens to detect it — decides what a
 * key collision means.
 */
export type IdempotencyClaim =
  | { kind: 'CLAIMED' }
  | { kind: 'REPLAY'; result: RequestWithdrawalResult }
  | { kind: 'CONFLICT' };

export interface WithdrawalIdempotencyPort {
  claim(input: {
    operation: 'REQUEST_WITHDRAWAL';
    key: string;
    fingerprint: string;
  }): Promise<IdempotencyClaim>;
  complete(key: string, result: RequestWithdrawalResult): Promise<void>;
}

export interface RequestWithdrawalDependencies {
  transactionRunner: TransactionRunner;
  idempotency: WithdrawalIdempotencyPort;
  walletReservation: WalletReservationPort;
  withdrawals: WithdrawalRepository;
  outbox: Outbox;
  withdrawalIdGenerator: IdGenerator<'WithdrawalId'>;
  eventIdGenerator: IdGenerator<'EventId'>;
  clock: Clock;
}

export class RequestWithdrawal {
  constructor(private readonly dependencies: RequestWithdrawalDependencies) {}

  execute(command: RequestWithdrawalCommand): Promise<RequestWithdrawalResult> {
    return this.dependencies.transactionRunner.run(async () => {
      const claim = await this.dependencies.idempotency.claim({
        operation: 'REQUEST_WITHDRAWAL',
        key: command.idempotencyKey,
        fingerprint: createRequestFingerprint(command),
      });

      switch (claim.kind) {
        case 'REPLAY':
          return claim.result;
        case 'CONFLICT':
          throw new IdempotencyKeyConflictError(command.idempotencyKey);
        case 'CLAIMED':
          break;
        default:
          return assertNever(claim);
      }

      const withdrawalId = this.dependencies.withdrawalIdGenerator.next();
      const { reservationId } =
        await this.dependencies.walletReservation.reserve({
          withdrawalId,
          userId: command.userId,
          amount: command.amount,
        });
      const occurredAt = this.dependencies.clock.now();
      const withdrawal = Withdrawal.request({
        id: withdrawalId,
        userId: command.userId,
        amount: command.amount,
        destinationAddress: command.destinationAddress,
        reservationId,
        createdAt: occurredAt,
      });

      await this.dependencies.withdrawals.add(withdrawal);
      await this.dependencies.outbox.append({
        id: this.dependencies.eventIdGenerator.next(),
        type: 'WithdrawalExecutionRequested',
        aggregateId: withdrawal.id,
        occurredAt,
        payload: {
          withdrawalId: withdrawal.id,
          userId: withdrawal.userId,
          asset: withdrawal.asset.code,
          amount: withdrawal.amount.toDecimalString(),
        },
      });

      const result: RequestWithdrawalResult = {
        withdrawalId: withdrawal.id,
        status: withdrawal.status,
        asset: withdrawal.asset.code,
        amount: withdrawal.amount.toDecimalString(),
      };
      await this.dependencies.idempotency.complete(
        command.idempotencyKey,
        result,
      );
      return result;
    });
  }
}
