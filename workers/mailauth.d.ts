declare module "mailauth/lib/dkim/verify" {
  export function dkimVerify(
    input: Uint8Array,
    options: {
      resolver: (name: string, type: string) => Promise<string[][]>;
      minBitLength: number;
      sender: string;
    },
  ): Promise<{
    headerFrom: string[];
    results: Array<{
      signingDomain?: string;
      algo?: string;
      modulusLength?: number;
      signatureTimeValid?: boolean;
      canonBodyLengthLimited?: boolean;
      bodyHash?: string;
      bodyHashExpecting?: string;
      publicKey?: string;
      signature?: string;
      signingHeaders?: { keys: string; canonicalizedHeader: string };
      status: { result: string; comment?: string };
    }>;
  }>;
}

declare module "mailauth/lib/dkim/sign" {
  export function dkimSign(
    input: Uint8Array,
    options: {
      algorithm?: string;
      headerList?: string;
      signatureData: Array<{
        signingDomain: string;
        selector: string;
        privateKey: string;
        maxBodyLength?: number;
      }>;
    },
  ): Promise<{ signatures: string; errors: unknown[] }>;
}
