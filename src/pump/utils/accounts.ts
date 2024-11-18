import { PublicKey } from "@solana/web3.js";
import { struct, bool, u64, publicKey, Layout } from "@coral-xyz/borsh";

export class GlobalAccount {
  public discriminator: bigint;
  public initialized: boolean = false;
  public authority: PublicKey;
  public feeRecipient: PublicKey;
  public initialVirtualTokenReserves: bigint;
  public initialVirtualSolReserves: bigint;
  public initialRealTokenReserves: bigint;
  public tokenTotalSupply: bigint;
  public feeBasisPoints: bigint;

  constructor(
    discriminator: bigint,
    initialized: boolean,
    authority: PublicKey,
    feeRecipient: PublicKey,
    initialVirtualTokenReserves: bigint,
    initialVirtualSolReserves: bigint,
    initialRealTokenReserves: bigint,
    tokenTotalSupply: bigint,
    feeBasisPoints: bigint
  ) {
    this.discriminator = discriminator;
    this.initialized = initialized;
    this.authority = authority;
    this.feeRecipient = feeRecipient;
    this.initialVirtualTokenReserves = initialVirtualTokenReserves;
    this.initialVirtualSolReserves = initialVirtualSolReserves;
    this.initialRealTokenReserves = initialRealTokenReserves;
    this.tokenTotalSupply = tokenTotalSupply;
    this.feeBasisPoints = feeBasisPoints;
  }

  getInitialBuyPrice(amount: bigint): bigint {
    if (amount <= 0n) {
      return 0n;
    }

    let n = this.initialVirtualSolReserves * this.initialVirtualTokenReserves;
    let i = this.initialVirtualSolReserves + amount;
    let r = n / i + 1n;
    let s = this.initialVirtualTokenReserves - r;
    return s < this.initialRealTokenReserves
      ? s
      : this.initialRealTokenReserves;
  }

  public static fromBuffer(buffer: Buffer): GlobalAccount {
    const structure: Layout<GlobalAccount> = struct([
      u64("discriminator"),
      bool("initialized"),
      publicKey("authority"),
      publicKey("feeRecipient"),
      u64("initialVirtualTokenReserves"),
      u64("initialVirtualSolReserves"),
      u64("initialRealTokenReserves"),
      u64("tokenTotalSupply"),
      u64("feeBasisPoints"),
    ]);

    let value = structure.decode(buffer);
    return new GlobalAccount(
      BigInt(value.discriminator),
      value.initialized,
      value.authority,
      value.feeRecipient,
      BigInt(value.initialVirtualTokenReserves),
      BigInt(value.initialVirtualSolReserves),
      BigInt(value.initialRealTokenReserves),
      BigInt(value.tokenTotalSupply),
      BigInt(value.feeBasisPoints)
    );
  }
}

export class BondingCurveAccount {
  public discriminator: bigint;
  public virtualTokenReserves: bigint;
  public virtualSolReserves: bigint;
  public realTokenReserves: bigint;
  public realSolReserves: bigint;
  public tokenTotalSupply: bigint;
  public complete: boolean;

  constructor(
    discriminator: bigint,
    virtualTokenReserves: bigint,
    virtualSolReserves: bigint,
    realTokenReserves: bigint,
    realSolReserves: bigint,
    tokenTotalSupply: bigint,
    complete: boolean
  ) {
    this.discriminator = discriminator;
    this.virtualTokenReserves = virtualTokenReserves;
    this.virtualSolReserves = virtualSolReserves;
    this.realTokenReserves = realTokenReserves;
    this.realSolReserves = realSolReserves;
    this.tokenTotalSupply = tokenTotalSupply;
    this.complete = complete;
  }

  getBuyPrice(amount: bigint): bigint {
    if (this.complete) {
      throw new Error("Curve is complete");
    }

    if (amount <= 0n) {
      return 0n;
    }

    // Calculate the product of virtual reserves
    let n = this.virtualSolReserves * this.virtualTokenReserves;

    // Calculate the new virtual sol reserves after the purchase
    let i = this.virtualSolReserves + amount;

    // Calculate the new virtual token reserves after the purchase
    let r = n / i + 1n;

    // Calculate the amount of tokens to be purchased
    let s = this.virtualTokenReserves - r;

    // Return the minimum of the calculated tokens and real token reserves
    return s < this.realTokenReserves ? s : this.realTokenReserves;
  }

  getSellPrice(amount: bigint, feeBasisPoints: bigint): bigint {
    if (this.complete) {
      throw new Error("Curve is complete");
    }

    if (amount <= 0n) {
      return 0n;
    }

    // Calculate the proportional amount of virtual sol reserves to be received
    let n =
      (amount * this.virtualSolReserves) / (this.virtualTokenReserves + amount);

    // Calculate the fee amount in the same units
    let a = (n * feeBasisPoints) / 10000n;

    // Return the net amount after deducting the fee
    return n - a;
  }

  getMarketCapSOL(): bigint {
    if (this.virtualTokenReserves === 0n) {
      return 0n;
    }

    return (
      (this.tokenTotalSupply * this.virtualSolReserves) /
      this.virtualTokenReserves
    );
  }

  getFinalMarketCapSOL(feeBasisPoints: bigint): bigint {
    let totalSellValue = this.getBuyOutPrice(
      this.realTokenReserves,
      feeBasisPoints
    );
    let totalVirtualValue = this.virtualSolReserves + totalSellValue;
    let totalVirtualTokens = this.virtualTokenReserves - this.realTokenReserves;

    if (totalVirtualTokens === 0n) {
      return 0n;
    }

    return (this.tokenTotalSupply * totalVirtualValue) / totalVirtualTokens;
  }

  getBuyOutPrice(amount: bigint, feeBasisPoints: bigint): bigint {
    let solTokens =
      amount < this.realSolReserves ? this.realSolReserves : amount;
    let totalSellValue =
      (solTokens * this.virtualSolReserves) /
        (this.virtualTokenReserves - solTokens) +
      1n;
    let fee = (totalSellValue * feeBasisPoints) / 10000n;
    return totalSellValue + fee;
  }

  public static fromBuffer(buffer: Buffer): BondingCurveAccount {
    const structure: Layout<BondingCurveAccount> = struct([
      u64("discriminator"),
      u64("virtualTokenReserves"),
      u64("virtualSolReserves"),
      u64("realTokenReserves"),
      u64("realSolReserves"),
      u64("tokenTotalSupply"),
      bool("complete"),
    ]);

    let value = structure.decode(buffer);
    return new BondingCurveAccount(
      BigInt(value.discriminator),
      BigInt(value.virtualTokenReserves),
      BigInt(value.virtualSolReserves),
      BigInt(value.realTokenReserves),
      BigInt(value.realSolReserves),
      BigInt(value.tokenTotalSupply),
      value.complete
    );
  }
}
