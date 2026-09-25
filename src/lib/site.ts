// Site-wide switches and links for the pages. Nothing here reaches a route handler.

/**
 * Gates both flows on the public site: paying from stock on /pay and payment requests on /merchant.
 * When false, each page shows a notice instead of its flow. Typed as boolean so both branches type-check.
 */
export const PAY_ENABLED: boolean = true;

export const REPO_URL = 'https://github.com/0xLubna/stocksol';
