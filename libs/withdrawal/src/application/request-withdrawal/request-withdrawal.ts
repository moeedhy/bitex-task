import type {
  Asset,
  Clock,
  IdGenerator,
  Money,
  Outbox,
  TransactionRunner,
} from '@bitex/platform';
import { Withdrawal } from '../../domain/withdrawal.js';
import type { WithdrawalRepository } from '../ports/withdrawal.repository.js';

export interface RequestWithdrawalCommand {
  idempotencyKey: string;
  fingerprint: string;
  userId: string;
  asset: Asset;
  amount: Money;
  destinationAddress: string;
}

export interface RequestWithdrawalResult {
  withdrawalId: string;
  status: 'PENDING';
  asset: string;
  amount: string;
}

export interface WalletReservationPort {
  reserve(input: {
    withdrawalId: string;
    userId: string;
    asset: Asset;
    amount: Money;
  }): Promise<{ reservationId: string }>;
}

export interface WithdrawalIdempotencyPort {
  claim(input: {
    operation: 'REQUEST_WITHDRAWAL';
    key: string;
    fingerprint: string;
  }): Promise<
    { kind: 'CLAIMED' } | { kind: 'REPLAY'; result: RequestWithdrawalResult }
  >;
  complete(key: string, result: RequestWithdrawalResult): Promise<void>;
}

export interface RequestWithdrawalDependencies {
  transactionRunner: TransactionRunner;
  idempotency: WithdrawalIdempotencyPort;
  walletReservation: WalletReservationPort;
  withdrawals: WithdrawalRepository;
  outbox: Outbox;
  withdrawalIdGenerator: IdGenerator;
  eventIdGenerator: IdGenerator;
  clock: Clock;
}

export class RequestWithdrawal {
  constructor(private readonly dependencies: RequestWithdrawalDependencies) {}

  execute(command: RequestWithdrawalCommand): Promise<RequestWithdrawalResult> {
    return this.dependencies.transactionRunner.run(async () => {
      const claim = await this.dependencies.idempotency.claim({
        operation: 'REQUEST_WITHDRAWAL',
        key: command.idempotencyKey,
        fingerprint: command.fingerprint,
      });
      if (claim.kind === 'REPLAY') {
        return claim.result;
      }

      const withdrawalId = this.dependencies.withdrawalIdGenerator.next();
      const { reservationId } =
        await this.dependencies.walletReservation.reserve({
          withdrawalId,
          userId: command.userId,
          asset: command.asset,
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
          destinationAddress: withdrawal.destinationAddress.value,
        },
      });

      const result: RequestWithdrawalResult = {
        withdrawalId: withdrawal.id,
        status: 'PENDING',
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
