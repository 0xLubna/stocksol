// Phantom may append Lighthouse assertion instructions to a transaction before submitting it. Only
// the post-sign check of what the wallet returned and the verifier accept them, and only at the
// end of the instruction list; what StockPay builds still ends with the transfer.
export const LIGHTHOUSE_PROGRAM_ID = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
