import { BN } from "bn.js";
import { Program, Provider } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Commitment,
  Connection,
  Finality,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
} from "@solana/web3.js";

import { jitoPumpBundle, jitoSellBundle } from "./jitoBundle";
import { PumpFunIDL, PumpFun } from "./utils/IDL";
import { GlobalAccount, BondingCurveAccount } from "./utils/accounts";
import {
  toCompleteEvent,
  toCreateEvent,
  toSetParamsEvent,
  toTradeEvent,
} from "./utils/events";
import {
  calculateWithSlippageBuy,
  calculateWithSlippageSell,
  chunkArray,
  createLookupTable,
  sendTx,
} from "./utils";
import {
  CompleteEvent,
  CreateEvent,
  CreateTokenMetadata,
  PriorityFee,
  PumpFunEventHandlers,
  PumpFunEventType,
  Result,
  SetParamsEvent,
  TradeEvent,
  TransactionResult,
} from "./utils/types";
import { commitmentType, eventAuthority, pumpFunProgram, rentProgram, systemProgram } from "../config";

export class PumpFunSDK {
  public GLOBAL_ACCOUNT_SEED = "global"
  public BONDING_CURVE_SEED = "bonding-curve"
  public METADATA_SEED = "metadata"
  public PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  public MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  public INITIAL_VIRTUAL_TOKEN_RESERVES = 1073000000000000n
  public INITIAL_VIRTUAL_SOL_RESERVES = 30000000000n
  public INITIAL_REAL_TOKEN_RESERVES = 793100000000000n
  public TOKEN_TOTAL_SUPPLY = 1000000000000000n
  public FEE_BASIS_POINTS = 100n
  public count: number

  public program: Program<PumpFun>;
  public connection: Connection;
  private associatedUsers: string[] = [];

  constructor(provider: Provider) {
    this.program = new Program<PumpFun>(PumpFunIDL as PumpFun, provider);
    this.connection = provider.connection;
    this.count = 5
  }

  async createAndBuy(
    creator: Keypair,
    createTokenMetadata: CreateTokenMetadata,
    buyAmountSol: bigint,
    mint?: Keypair,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = commitmentType.Confirmed,
    finality: Finality = commitmentType.Finalized
  ): Promise<TransactionResult> {
    const tokenMetadata = await this.createTokenMetadata(createTokenMetadata);

    if (!mint) mint = Keypair.generate();
    const createTx = await this.getCreateInstructions(
      creator.publicKey,
      createTokenMetadata.name,
      createTokenMetadata.symbol,
      tokenMetadata.metadataUri,
      mint
    );

    const newTx = new Transaction().add(createTx);

    if (buyAmountSol > 0) {
      const globalAccount = await this.getGlobalAccount(commitment);
      const buyAmount = globalAccount.getInitialBuyPrice(buyAmountSol);
      const buyAmountWithSlippage = calculateWithSlippageBuy(
        buyAmountSol,
        slippageBasisPoints
      );

      const buyTx = await this.getBuyInstructions(
        creator.publicKey,
        mint.publicKey,
        globalAccount.feeRecipient,
        buyAmount,
        buyAmountWithSlippage
      );

      newTx.add(buyTx);
    }

    const createAndBuyResults = await sendTx(
      this.connection,
      newTx,
      creator.publicKey,
      [creator, mint],
      priorityFees,
      commitment,
      finality
    );

    createAndBuyResults.results = { mint: mint.publicKey.toBase58() };
    return createAndBuyResults;
  }

  async createAndBatchBuy(
    creator: Keypair,
    buyers: Array<Keypair>,
    buyAmountSol: Array<bigint>,
    createTokenMetadata: CreateTokenMetadata,
    mint?: Keypair,
    walletCounts?: number,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = commitmentType.Confirmed,
    finality: Finality = commitmentType.Finalized
  ) {
    if (!mint) mint = Keypair.generate();

    console.log('mint', mint.publicKey.toBase58())

    const tokenMetadata = await this.createTokenMetadata(createTokenMetadata);
    if (!tokenMetadata) {
      return {
        success: false,
        error: "creating token metadata error",
      };
    }

    const payer = creator;

    const mintAtaList = buyers.map((item) =>
      getAssociatedTokenAddressSync(mint.publicKey, item.publicKey)
    );

    // create lookup table
    const globalAccount = await this.getGlobalAccount("finalized");
    const associatedBondingCurve = getAssociatedTokenAddressSync(
      mint.publicKey,
      this.getBondingCurvePDA(mint.publicKey),
      true
    );
    const lutAddressList = [
      // shortening codebase ...
    ];

    const lutResult = await createLookupTable(
      this.connection,
      payer,
      lutAddressList
    );
    if (lutResult.Err) {
      console.error("error occurs while creating lut");
      return {
        success: false,
        error: "creating lut table account error",
      };
    }

    const lutAddress = lutResult.Ok?.lookupTable;

    if (!lutAddress)
      return {
        success: false,
        error: "getting lut table address error",
      };
    console.log('lutAddress', lutAddress.toBase58())

    const createTx = await this.getCreateInstructions(
      payer.publicKey,
      createTokenMetadata.name,
      createTokenMetadata.symbol,
      tokenMetadata.metadataUri,
      mint
    );

    const splitedKeypairArray = chunkArray(buyers, this.count);
    const splitedAmountArray = chunkArray(buyAmountSol, this.count);

    const buyTx = await this.batchBuyInx(
      splitedKeypairArray,
      splitedAmountArray,
      mint.publicKey,
      new PublicKey(lutAddress),
      globalAccount
    );

    if (buyTx.Err) {
      return {
        success: false,
        error: buyTx.Err.message,
      };
    }

    if (buyTx.Ok) {
      const lookupTable = (
        await this.connection.getAddressLookupTable(lutAddress)
      ).value;

      if (lookupTable == null) {
        console.error("lookup table creation failed");
        return {
          success: false,
          error: "getting lut data error",
        };
      }

      const buyVTxList: Array<VersionedTransaction> = []

      for (const [i, tx] of buyTx.Ok.txList.entries()) {
        const latestBlockhash = await this.connection.getLatestBlockhash('finalized');
        const buyTxMsg = new TransactionMessage({
          payerKey: payer.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: tx.instructions
        }).compileToV0Message([lookupTable]);

        const buyVTx = new VersionedTransaction(buyTxMsg);
        buyVTx.sign([splitedKeypairArray[0][0], ...splitedKeypairArray[i]])

        buyVTxList.push(buyVTx)
      }

      const bundleResult = await jitoPumpBundle(
        createTx,
        [payer, mint],
        buyVTxList,
        payer
      );
      if (bundleResult.confirmed) {
        return {
          success: true,
          mint: mint.publicKey.toBase58(),
          bundleId: bundleResult.bundleId,
          tipTx: bundleResult.jitoTxsignature,
          lutAddress
        };
      } else {
        return {
          success: false,
          error: "bundling error",
        };
      }
    }
  }

  async batchSell(
    payer: Keypair,
    mint: PublicKey,
    sellers: Array<Keypair>,
    sellTokenAmount: Array<bigint>,
    lutAddress?: PublicKey,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = commitmentType.Confirmed,
    finality: Finality = commitmentType.Finalized
  ): Promise<TransactionResult> {
    const splitedKeypairArray = chunkArray(sellers, this.count);
    const splitedAmountArray = chunkArray(sellTokenAmount, this.count);

    const sellTx = await this.batchSellInx(
      splitedKeypairArray,
      splitedAmountArray,
      mint
    );

    if (sellTx.Err) {
      return {
        success: false,
        error: sellTx.Err.message,
      };
    }

    if (sellTx.Ok) {
      const lookupTable = lutAddress ? (
        await this.connection.getAddressLookupTable(lutAddress)
      ).value : null;

      const sellVTxList: Array<VersionedTransaction> = [];

      for (const [i, tx] of sellTx.Ok.txList.entries()) {
        const latestBlockhash = await this.connection.getLatestBlockhash(
          "finalized"
        );
        const sellTxMsg = lookupTable ? new TransactionMessage({
          payerKey: payer.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: tx.instructions,
        }).compileToV0Message([lookupTable]) : new TransactionMessage({
          payerKey: payer.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: tx.instructions,
        }).compileToV0Message([]);

        const sellVTx = new VersionedTransaction(sellTxMsg);
        sellVTx.sign([splitedKeypairArray[0][0], ...splitedKeypairArray[i]]);

        sellVTxList.push(sellVTx);
      }

      const bundleResult = await jitoSellBundle(sellVTxList, payer);
      if (bundleResult.confirmed) {
        return {
          success: true,
          results: {
            mint: mint.toBase58(),
            bundleId: bundleResult.bundleId,
            tipTx: bundleResult.jitoTxsignature,
          },
        };
      } else {
        return {
          success: false,
          error: "bundling error",
        };
      }
    } else {
      return {
        success: false,
        error: "sell tx error",
      };
    }
  }

  async createTokenMetadata(create: CreateTokenMetadata) {
    try {
      const formData = new FormData();
      formData.append("file", create.file)
      formData.append("name", create.name)
      formData.append("symbol", create.symbol)
      formData.append("description", create.description)
      formData.append("twitter", create.twitter || "")
      formData.append("telegram", create.telegram || "")
      formData.append("website", create.website || "")
      formData.append("showName", "true")
      const request = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        headers: {
          Host: "www.pump.fun",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          Referer: "https://www.pump.fun/create",
          Origin: "https://www.pump.fun",
          Connection: "keep-alive",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          Priority: "u=1",
          TE: "trailers",
        },
        body: formData,
      });
      return request.json();
    } catch (error) {
      console.error(error)
      return null
    }
  }

  async buy(
    buyer: Keypair,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = commitmentType.Confirmed,
    finality: Finality = commitmentType.Finalized
  ): Promise<TransactionResult> {
    const buyTx = await this.getBuyInstructionsBySolAmount(
      buyer.publicKey,
      mint,
      buyAmountSol,
      slippageBasisPoints,
      commitment
    );

    const buyResults = await sendTx(
      this.connection,
      buyTx,
      buyer.publicKey,
      [buyer],
      priorityFees,
      commitment,
      finality
    );
    return buyResults;
  }

  async sell(
    seller: Keypair,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = commitmentType.Confirmed,
    finality: Finality = commitmentType.Finalized
  ): Promise<TransactionResult> {
    const sellTx = await this.getSellInstructionsByTokenAmount(
      seller.publicKey,
      mint,
      sellTokenAmount,
      slippageBasisPoints,
      commitment
    );

    const sellResults = await sendTx(
      this.connection,
      sellTx,
      seller.publicKey,
      [seller],
      priorityFees,
      commitment,
      finality
    );
    return sellResults;
  }

  async batchBuyInx(
    splitedKeypairArray: Array<Array<Keypair>>,
    splitedAmountArray: Array<Array<bigint>>,
    mint: PublicKey,
    lut: PublicKey,
    globalAccount: GlobalAccount,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = commitmentType.Confirmed,
    finality: Finality = commitmentType.Finalized
  ): Promise<Result<{ txList: Array<Transaction> }, { message: string }>> {
    const associatedBondingCurve = await getAssociatedTokenAddress(
      mint,
      this.getBondingCurvePDA(mint),
      true
    );

    const buyTxList: Array<Transaction> = []

    for (const [i, array] of splitedKeypairArray.entries()) {
      const inxList: Array<TransactionInstruction> = []
      for (const [j, keypairItem] of array.entries()) {
        const associatedUser = getAssociatedTokenAddressSync(mint, keypairItem.publicKey)

        inxList.push(
          createAssociatedTokenAccountInstruction(
            splitedKeypairArray[0][0].publicKey,
            associatedUser,
            keypairItem.publicKey,
            mint
          )
        );

        // shortening codebase ...
      }
      const createTx = new Transaction().add(...inxList);
      buyTxList.push(createTx)
    }

    return {
      Ok: {
        txList: buyTxList
      }
    }
  }

  async batchSellInx(
    splitedKeypairArray: Array<Array<Keypair>>,
    splitedAmountArray: Array<Array<bigint>>,
    mint: PublicKey,
    slippageBasisPoints: bigint = 9999n,
    priorityFees?: PriorityFee,
    commitment: Commitment = commitmentType.Confirmed,
    finality: Finality = commitmentType.Finalized
  ): Promise<Result<{ txList: Array<Transaction> }, { message: string }>> {
    const globalAccount = await this.getGlobalAccount(commitment);
    const associatedBondingCurve = await getAssociatedTokenAddress(
      mint,
      this.getBondingCurvePDA(mint),
      true
    );

    const bondingCurveAccount = await this.getBondingCurveAccount(
      mint,
      commitment
    );

    if (!bondingCurveAccount) {
      return {
        Err: {
          message: "bonding curve account error",
        },
      };
    }

    const sellTxList: Array<Transaction> = [];
    for (const [i, array] of splitedKeypairArray.entries()) {
      const inxList: Array<TransactionInstruction> = [];
      for (const [j, keypairItem] of array.entries()) {
        const associatedUser = getAssociatedTokenAddressSync(mint, keypairItem.publicKey)

        // shortening codebase ...
      }
      const createTx = new Transaction().add(...inxList);
      sellTxList.push(createTx);
    }

    return {
      Ok: {
        txList: sellTxList,
      },
    };
  }

  async getCreateInstructions(
    creator: PublicKey,
    name: string,
    symbol: string,
    uri: string,
    mint: Keypair
  ) {
    const mplTokenMetadata = this.MPL_TOKEN_METADATA_PROGRAM_ID;

    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(this.METADATA_SEED),
        mplTokenMetadata.toBuffer(),
        mint.publicKey.toBuffer(),
      ],
      mplTokenMetadata
    );

    const associatedBondingCurve = await getAssociatedTokenAddress(
      mint.publicKey,
      this.getBondingCurvePDA(mint.publicKey),
      true
    );

    return this.program.methods
      .create(name, symbol, uri, creator)
      .accounts({
        mint: mint.publicKey,
        associatedBondingCurve,
        metadata: metadataPDA,
        user: creator,
      })
      .signers([mint])
      .transaction();
  }

  async getBuyInstructionsBySolAmount(
    buyer: PublicKey,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = commitmentType.Confirmed
  ) {
    const bondingCurveAccount = await this.getBondingCurveAccount(
      mint,
      commitment
    );
    if (!bondingCurveAccount) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    const buyAmount = bondingCurveAccount.getBuyPrice(buyAmountSol);
    const buyAmountWithSlippage = calculateWithSlippageBuy(
      buyAmountSol,
      slippageBasisPoints
    );

    const globalAccount = await this.getGlobalAccount(commitment);

    return await this.getBuyInstructions(
      buyer,
      mint,
      globalAccount.feeRecipient,
      buyAmount,
      buyAmountWithSlippage
    );
  }

  async getBuyInstructions(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    solAmount: bigint,
    commitment: Commitment = commitmentType.Confirmed
  ) {
    const associatedBondingCurve = await getAssociatedTokenAddress(
      mint,
      this.getBondingCurvePDA(mint),
      true
    );

    const associatedUser = await getAssociatedTokenAddress(mint, buyer, false);

    const transaction = new Transaction();

    try {
      await getAccount(this.connection, associatedUser, commitment);
    } catch (e) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          buyer,
          associatedUser,
          buyer,
          mint
        )
      );
    }

    transaction.add(
      await this.program.methods
        .buy(new BN(amount.toString()), new BN(solAmount.toString()))
        .accounts({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedBondingCurve: associatedBondingCurve,
          associatedUser: associatedUser,
          user: buyer,
        })
        .transaction()
    );

    return transaction;
  }

  async getSellInstructionsByTokenAmount(
    seller: PublicKey,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = commitmentType.Confirmed
  ) {
    const bondingCurveAccount = await this.getBondingCurveAccount(
      mint,
      commitment
    );
    if (!bondingCurveAccount) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    const globalAccount = await this.getGlobalAccount(commitment);

    const minSolOutput = bondingCurveAccount.getSellPrice(
      sellTokenAmount,
      globalAccount.feeBasisPoints
    );

    const sellAmountWithSlippage = calculateWithSlippageSell(
      minSolOutput,
      slippageBasisPoints
    );

    return await this.getSellInstructions(
      seller,
      mint,
      globalAccount.feeRecipient,
      sellTokenAmount,
      sellAmountWithSlippage
    );
  }

  async getSellInstructions(
    seller: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    minSolOutput: bigint
  ) {
    const associatedBondingCurve = await getAssociatedTokenAddress(
      mint,
      this.getBondingCurvePDA(mint),
      true
    );

    const associatedUser = await getAssociatedTokenAddress(mint, seller, false);

    const transaction = new Transaction();

    transaction.add(
      await this.program.methods
        .sell(new BN(amount.toString()), new BN(minSolOutput.toString()))
        .accounts({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedBondingCurve: associatedBondingCurve,
          associatedUser: associatedUser,
          user: seller,
        })
        .transaction()
    );

    return transaction;
  }

  async getBondingCurveAccount(
    mint: PublicKey,
    commitment: Commitment = commitmentType.Confirmed
  ) {
    const tokenAccount = await this.connection.getAccountInfo(
      this.getBondingCurvePDA(mint),
      commitment
    );
    if (!tokenAccount) {
      return null;
    }
    return BondingCurveAccount.fromBuffer(tokenAccount!.data);
  }

  async getGlobalAccount(commitment: Commitment = commitmentType.Confirmed) {
    const [globalAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(this.GLOBAL_ACCOUNT_SEED)],
      this.PROGRAM_ID
    );

    const tokenAccount = await this.connection.getAccountInfo(
      globalAccountPDA,
      commitment
    );

    return GlobalAccount.fromBuffer(tokenAccount!.data);
  }

  getBondingCurvePDA(mint: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(this.BONDING_CURVE_SEED), mint.toBuffer()],
      this.program.programId
    )[0];
  }

  getBundleBuyPrice(amount: bigint) {
    const n = this.INITIAL_VIRTUAL_SOL_RESERVES * this.INITIAL_VIRTUAL_TOKEN_RESERVES
    const i = this.INITIAL_VIRTUAL_SOL_RESERVES + amount
    const r = n / i + 1n
    const s = this.INITIAL_VIRTUAL_TOKEN_RESERVES - r
    return s < this.INITIAL_REAL_TOKEN_RESERVES ? s : this.INITIAL_REAL_TOKEN_RESERVES;
  }

  addEventListener<T extends PumpFunEventType>(
    eventType: T,
    callback: (
      event: PumpFunEventHandlers[T],
      slot: number,
      signature: string
    ) => void
  ) {
    return this.program.addEventListener(
      eventType,
      (event: any, slot: number, signature: string) => {
        let processedEvent;
        switch (eventType) {
          case "createEvent":
            processedEvent = toCreateEvent(event as CreateEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          case "tradeEvent":
            processedEvent = toTradeEvent(event as TradeEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          case "completeEvent":
            processedEvent = toCompleteEvent(event as CompleteEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          case "setParamsEvent":
            processedEvent = toSetParamsEvent(event as SetParamsEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          default:
            console.error("Unhandled event type:", eventType);
        }
      }
    );
  }

  removeEventListener(eventId: number) {
    this.program.removeEventListener(eventId);
  }
}
