# StockPay

**Pay from tokenized stocks. Get paid in USDC.**

StockPay pays a Solana Pay USDC request, or sends USDC to any Solana wallet address, straight from tokenized stocks you hold. You approve once: when the route fits, one non-custodial Solana transaction sells just enough of your holding through Jupiter, pays the exact USDC amount, and leaves the change in your wallet. The person you pay only ever receives USDC.

**Built and tested on mainnet.** The payment log below links real payments made from tokenized stock. The [public site](https://stocksol.vercel.app) takes no payments; you can run the pay and merchant pages yourself (see Run it yourself).

> **Status:** open-source prototype built for the Stocklana hackathon. Not offered as a service and not registered with any regulator. StockPay never holds funds or keys. Not financial advice.

## Payment log

All on Solana mainnet, 24 and 25 Sep 2026 (UTC), each paid from tokenized stock through StockPay: SPYx for 1 and 2, TSLAx for 3, NVDAx for 4.

| # | What happened | Amount | Transaction |
|---|---|---|---|
| 1 | From SPYx to a Solana Pay request; the merchant page found it by reference | 2.000197 USDC | [2gz1yi...K5xE](https://explorer.solana.com/tx/2gz1yidCKLjd4SvecSEavg4bnMFes1ka3J69iyQdH2c42uHug5J1Ti7jyaAUt9tqtKbdS98Et3omSLtsv78VK5xE) |
| 2 | From SPYx to a wallet address, after the US market close; our verifier passed it | 1.000000 USDC | [5zrBTd...yeuF](https://explorer.solana.com/tx/5zrBTdnnSs9EdQG98s1j5chAxbgkk8MicXoKK7qCC1JmxaSANAPPRCaUQ3bXBq52nAgodJ1Db2iDaXwBkoj1yeuF) |
| 3 | From TSLAx to a Solana Pay request, 25 Sep; found by reference; our verifier passed it | 2.000876 USDC | [2dL6fs...xdwu](https://explorer.solana.com/tx/2dL6fsnmNJLpGzGxNoXwpni4BrqF74ENnSKR8zUkdGerSgAGRLFfZkTKypK7V2rxpmbsawUxok5hHmZ5z12Wxdwu) |
| 4 | From NVDAx to a Solana Pay request, 25 Sep, after a smaller request was refused (see What we found); found by reference; our verifier passed it | 3.000008 USDC | [62V9nZ...9f3B](https://explorer.solana.com/tx/62V9nZ27jYP9MAMhRS9WhxjL8QAjNKUQDLAfSgwzugJhtGGFAggT4i7jYkFqED3pxMwr3i6aJG3nBsdhZdBk9f3B) |

**How to read it:** open payment 1. The Jupiter swap that sells SPYx and the USDC transfer to the payee sit in the same transaction, and the transfer carries the request's reference key; the only instructions after it are Lighthouse assertions that Phantom added (see What we found). The sale and the payment happen together or not at all.

### From quote to Paid

**Quote on the pay page (payment 1)**

![Pay page quote for payment 1](docs/quote.png)

**Approval in Phantom (payment 1)**

![Phantom approval for payment 1](docs/approval.png)

**Merchant page after a plain-USDC test payment: Paid, matched by reference**

![Merchant page showing a plain-USDC payment Paid, matched by reference](docs/paid.png)

## How it works

```
Payer's wallet                StockPay                     Solana
     |   scan or paste request   |                            |
     |-------------------------->|  validate, quote (Jupiter), |
     |                           |  build and simulate         |
     |<--------------------------|  one transaction            |
     |  page checks the transaction before you sign            |
     |  approve once                                           |
     |--------------------------------------------------------->|
     |   [compute budget] [Jupiter: sell just enough stock]     |
     |   [create payee USDC account if needed]                  |
     |   [exact USDC transfer to payee, with reference]  (last) |
     |                                                          |
Merchant page  <------ finds the payment by reference or exact amount, verifies it
```

- **One transaction when it fits.** Versioned transactions with address lookup tables keep the sale and the payment under Solana's 1,232-byte limit. Payment 2 was built at 850 bytes; without lookup tables it would have been 1,247, over the limit. A route too large for one transaction is split into two, signed together; two transactions are not all-or-nothing, so if the payment fails after the sale lands, the payee is not paid and the USDC stays in your wallet.
- **Exact amount, change stays with you.** The sale is sized so the route's minimum output after slippage covers the payment; anything above the payment stays in your wallet.

## Checks before you sign

The page decodes every transaction and refuses to ask for a signature unless:

- the last instruction is the exact USDC transfer to the payee, with the reference attached read-only;
- only the expected programs appear at the top level, and the only direct token instruction is that final transfer;
- a simulation shows your holding falls by no more than quoted, the sale brings in at least the route's minimum output, your SOL moves only by the quoted cost, and none of your token accounts gains a new delegate, owner or close authority;
- the request is not already paid, by its reference or by an exact-amount payment from your wallet in the last 24 hours.

After you sign, it checks what the wallet returned and simulates it again before sending.

## What we found

- **Phantom's own send dropped the Solana Pay reference.** Paying a StockPay QR with Phantom's built-in send delivered the right token and amount but omitted the reference ([transaction](https://explorer.solana.com/tx/5WjNgNHKDHvCAwBnr3qS8y2B7APgA4XARVnBQkTmGHo1Wej8gLULjB34rfV9KCki7bESwjj9GabK9zCZqmQrjFmK)), so a merchant watching the reference never sees it. Solflare's send kept the reference ([first](https://explorer.solana.com/tx/4212WzNsmvCoL3NTTvB9QwXNh12JTHe4PPFp9oHhonF4udfYm379ygUVP2ijHXxexnX59PkWMgFBXdhjnaxSUcmx), [second](https://explorer.solana.com/tx/5KgNRT9jds1zm9xkqxUpEYTxPPEfmoxX39ccTXJfcHuxHQ1C49ZMH1Cv4UbS3oRBBWK6Bm59q5nyxhPtoynMg3nG)). StockPay requests now add a few millionths of a USDC, and the merchant page also matches the exact amount arriving in its USDC account, which is how it found [a plain USDC send from Phantom](https://explorer.solana.com/tx/ob1vfDZ5ewAjZC6NjPVY3AcHYbjujPZapz5qM8pcggvS1DzGjPWsD3Y2wjfKrLfK38YmE256AibHMWuTwTByaFW).
- **Wallets pay requests that are already paid.** The wallets we tested don't check whether a Solana Pay request is already paid. After the merchant page showed Paid for that Phantom send, the same request was paid twice more with plain USDC sends ([urUSvd...12u4](https://explorer.solana.com/tx/urUSvdc3gd4xucKziLCmvwEUcW2ZF2NNvuhGRrY7H67GUMPHAsq2hJRavPf4qZQAw69P7p85WPxiihvep4112u4), [57RUby...UsRu](https://explorer.solana.com/tx/57RUbyKjQh4NkLpFLEH4WhaG3PYg2wxgWrodYF43uEZg9tfhRbLHU325PvWXbdmVbBWoFqYHm6sZD4LVtp2uUsRu)), and both went through. StockPay's pay page refused that link as already paid, and the merchant page now hides the QR once a request is paid.
- **Phantom changes the transaction you sign.** Phantom returned our transaction with Lighthouse assertion instructions added after our transfer (three on payments 2 to 4), which our original check refused. Payment 1 grew from the 758 bytes we built to 882 as it landed. Phantom documents that it may add Lighthouse assertions. The pay page now allows only Lighthouse assertions after the transfer.
- **xStocks amounts differ between screens.** SPYx and NVDAx carry a scaled-UI multiplier, and screens disagree on applying it, even within one app: when we paid from SPYx, Phantom's approval screen applied it and its token list didn't, a difference of about 0.57%. Solana Explorer, Solscan's transaction summary and our page apply it.
- **Our checks refused a five-pool route.** Paying a 1 USDC request from NVDAx, the quote came back across five pools; at 1,087 bytes it would have fit, but it carried a token instruction besides the final transfer, so the pay page refused it before asking for a signature. At 3 USDC the route used one pool and the payment went through (payment 4).
- **The standard verifier could not read these transactions.** The Solana Pay library's `validateTransfer` could not verify versioned transactions with lookup tables in the versions we checked (0.2.6 and 1.0.26), so StockPay verifies payments with its own verifier.

## Why not just swap, then send?

In Phantom that is two approvals, you work out the amount yourself, and Phantom adds its own swap fee. StockPay is one approval, the payee receives the exact amount, and the Jupiter route type it uses charges no Jupiter fee. Pool fees and network fees still apply.

## Why Solana

- **The stock is already here.** Tokenized stocks trade on Solana around the clock (Solana said on X in September 2026 that 63% of tokenized-equity volume on Solana was outside traditional market hours as of August 2026).
- **Sale and payment fit in one transaction**, thanks to versioned transactions with lookup tables.
- **The merchant needs no database.** Solana's RPC can list the transactions that include an account, so the reference lets the merchant page find and verify its payment straight from the chain, with no custody.

## Limits

- Three holdings in this version: SPYx, NVDAx and TSLAx (xStocks). Paying from stock is tested with Phantom mobile only. Payments below 25 USDC.
- Solana Pay USDC transfer requests only (no SOL requests, memos or transaction requests).
- A route through several pools can leave an empty account for an intermediate token in your wallet; the wallet can close it to reclaim its rent.
- While a Solana Pay link is loaded, the pay page ignores the typed recipient and amount rather than hiding those fields.

## Run it yourself

Tested with Node.js 22 and pnpm 11. Mainnet only: payments move real funds.

```sh
pnpm install
pnpm dev
pnpm test
```

Put `JUPITER_API_KEY` (a Jupiter API key) and `HELIUS_RPC_URL` (a Helius mainnet RPC URL) in a `.env` file at the repo root; only the server reads them.

Payments are switched off by default. To run both flows, set `PAY_ENABLED` to `true` in `src/lib/site.ts`, create a request on `/merchant`, and pay it on `/pay` from a wallet holding SPYx, NVDAx or TSLAx and a little SOL. Pay from a different wallet than the one receiving: a payment to yourself moves USDC out of and back into one account, so the verifier, which checks that the payee's USDC balance rose by at least the amount, fails it.

We tested paying from stock with Phantom mobile over HTTPS, so an HTTPS deployment of your own is the closest match.

Automated tests: 147 passing (`pnpm test`).

## Security notes

- Non-custodial: every transaction is signed in your own wallet.
- API keys stay on the server. The browser reaches Solana only through `/api/rpc`, which forwards an allowlist of RPC methods and caps request size.
- Payments are verified by StockPay's own verifier, not by trusting the wallet or the page.
- Inputs are validated on the server: wallet addresses, amounts (up to 6 decimals, capped), references.
- Pages cannot be framed by other sites.
- The xStocks issuer retains controls over these tokens, including a permanent delegate, pause and a transfer-hook authority; StockPay cannot override them.

## Eligibility

xStocks are not offered to US persons, and wallets restrict other regions. Use StockPay only where it is lawful for you to do so.

## What's next

- Use your USDC first, selling stock only for the shortfall.
- An open-source pay-from-holdings library that wallets can build in.
- An agent payer that settles requests from a holding within set limits.

## Open source

MIT licensed. Built with Next.js, `@solana/web3.js`, `@solana/spl-token`, the Solana wallet adapter, `@solana/pay` (request links only) and `qrcode`, on the Jupiter Swap and Tokens APIs and Helius RPC.
