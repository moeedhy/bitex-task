import type { ReservationId } from '@bitex/platform';
import type { ReserveFunds, SettleReservation } from '@bitex/wallet';
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
 * Both are transaction participants: they are invoked inside a transaction the
 * caller already opened, and the wallet repositories fail fast if that is not
 * true.
 */
export class WalletReservationAdapter implements WalletReservationPort {
  constructor(private readonly reserveFunds: ReserveFunds) {}

  reserve(input: Parameters<WalletReservationPort['reserve']>[0]) {
    return this.reserveFunds.execute(input);
  }
}

/**
 * Translates Withdrawal's two-method vocabulary onto Wallet's one use case.
 *
 * This used to fan two Wallet classes into one port, which is why those classes
 * existed separately at all. Now the translation is the whole adapter: the port
 * names *what* happens to the funds, the command names it in Wallet's terms.
 */
export class WalletSettlementAdapter implements WalletSettlementPort {
  constructor(private readonly settleReservation: SettleReservation) {}

  finalize(reservationId: ReservationId): Promise<void> {
    return this.settleReservation.execute({
      reservationId,
      outcome: 'FINALIZE',
    });
  }

  release(reservationId: ReservationId): Promise<void> {
    return this.settleReservation.execute({
      reservationId,
      outcome: 'RELEASE',
    });
  }
}
