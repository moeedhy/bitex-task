import type { ReservationId } from '@bitex/platform';
import type {
  FinalizeReservation,
  ReleaseReservation,
  ReserveFunds,
} from '@bitex/wallet';
import type {
  WalletReservationPort,
  WalletSettlementPort,
} from '@bitex/withdrawal';

/**
 * The bridge between the two modules, and the only place that knows both.
 *
 * The ports are declared by Withdrawal (the consumer) and satisfied here by
 * Wallet use cases. Because the adapters live at the composition root, neither
 * library imports the other — Withdrawal never sees a wallet aggregate or
 * repository, and Wallet never learns that withdrawals exist.
 *
 * Both adapters are transaction participants: they are invoked inside a
 * transaction the caller already opened, and the wallet repositories fail fast
 * if that is not true.
 */
export class WalletReservationAdapter implements WalletReservationPort {
  constructor(private readonly reserveFunds: ReserveFunds) {}

  reserve(input: Parameters<WalletReservationPort['reserve']>[0]) {
    return this.reserveFunds.execute(input);
  }
}

export class WalletSettlementAdapter implements WalletSettlementPort {
  constructor(
    private readonly finalizeReservation: FinalizeReservation,
    private readonly releaseReservation: ReleaseReservation,
  ) {}

  finalize(reservationId: ReservationId): Promise<void> {
    return this.finalizeReservation.execute(reservationId);
  }

  release(reservationId: ReservationId): Promise<void> {
    return this.releaseReservation.execute(reservationId);
  }
}
