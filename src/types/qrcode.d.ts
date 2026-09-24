// qrcode 1.5.4 ships no types; only what the merchant page uses is declared.
declare module 'qrcode' {
  export function toDataURL(text: string, options?: { width?: number; margin?: number }): Promise<string>;
}
