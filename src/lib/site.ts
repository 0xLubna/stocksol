// Site-wide switches and links for the pages. Nothing here reaches a route handler.

/**
 * Whether the public site lets a visitor pay from stock. When false, /pay shows a notice instead of
 * the pay flow and /merchant shows no scan-to-pay QR. Typed as boolean so both branches type-check.
 */
export const PAY_ENABLED: boolean = false;

export const REPO_URL = 'https://github.com/0xLubna/stocksol';
