/**
 * Lookup failures are application/persistence outcomes rather than domain
 * rules, so they live with the ports that raise them.
 */
export class WalletNotFoundError extends Error {
  readonly code = 'WALLET_NOT_FOUND' as const;

  constructor(readonly walletRef: string) {
    super(`Wallet "${walletRef}" was not found.`);
    this.name = 'WalletNotFoundError';
  }
}

export class ReservationNotFoundError extends Error {
  readonly code = 'RESERVATION_NOT_FOUND' as const;

  constructor(readonly reservationId: string) {
    super(`Reservation "${reservationId}" was not found.`);
    this.name = 'ReservationNotFoundError';
  }
}
