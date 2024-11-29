import { BN } from "bn.js";
import { Program, Provider } from "@coral-xyz/anchor";
import {
    createAssociatedTokenAccountInstruction,
    getAccount,
    getAssociatedTokenAddress,
    getAssociatedTokenAddressSync,
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
import { commitmentType } from "../config";

export class PumpFunSDK {
    public GLOBAL_ACCOUNT_SEED = "global"
    public BONDING_CURVE_SEED = "bonding-curve"
    public METADATA_SEED = "metadata"
    public GLOBAL_MINT = new PublicKey("Hf7SSrAovo2p2zoVewsVuFXzEAcAFVXw5tqJpGnkHbom")
    public PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    public MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
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
        slippageBasisPoints: bigint = 500n,
        priorityFees?: PriorityFee,
        mint?: Keypair,
        commitment: Commitment = commitmentType.Confirmed,
        finality: Finality = commitmentType.Finalized
    ): Promise<TransactionResult> {
        const tokenMetadata = await this.createTokenMetadata(createTokenMetadata);

        if (!mint) mint = Keypair.generate()
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

        createAndBuyResults.results = { mint: mint.publicKey.toBase58() }
        return createAndBuyResults
    }

    async createAndBatchBuy(
        creator: Array<Keypair>,
        buyAmountSol: Array<bigint>,
        createTokenMetadata: CreateTokenMetadata,
        mint?: Keypair,
        walletCounts?: number,
        slippageBasisPoints: bigint = 500n,
        priorityFees?: PriorityFee,
        commitment: Commitment = commitmentType.Confirmed,
        finality: Finality = commitmentType.Finalized
    ) {
        // shortening codebase...
    }

    async batchSell(
        creator: Array<Keypair>,
        sellAmount: Array<bigint>,
        createTokenMetadata: CreateTokenMetadata,
        mint: PublicKey,
        walletCounts?: number,
        slippageBasisPoints: bigint = 500n,
        priorityFees?: PriorityFee,
        commitment: Commitment = commitmentType.Confirmed,
        finality: Finality = commitmentType.Finalized
    ) {
        // shortening codebase...
    }

    async createTokenMetadata(create: CreateTokenMetadata) {
        const formData = new FormData();
        formData.append("file", create.file),
            formData.append("name", create.name),
            formData.append("symbol", create.symbol),
            formData.append("description", create.description),
            formData.append("twitter", create.twitter || ""),
            formData.append("telegram", create.telegram || ""),
            formData.append("website", create.website || ""),
            formData.append("showName", "true");
        const request = await fetch("https://pump.fun/api/ipfs", {
            method: "POST",
            headers: {
                "Host": "www.pump.fun",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Referer": "https://www.pump.fun/create",
                "Origin": "https://www.pump.fun",
                "Connection": "keep-alive",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "Priority": "u=1",
                "TE": "trailers"
            },
            body: formData,
        });
        return request.json();
    }

    async batchBuyInx(
        splitedKeypairArray: Array<Array<Keypair>>,
        splitedAmountArray: Array<Array<bigint>>,
        mint: PublicKey,
        lut: PublicKey,
        slippageBasisPoints: bigint = 500n,
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

        this.associatedUsers.splice(0, this.associatedUsers.length);

        const buyTxList: Array<Transaction> = []
        for (const [i, array] of splitedKeypairArray.entries()) {
            const inxList: Array<TransactionInstruction> = []
            for (const [j, keypairItem] of array.entries()) {
                console.log('keypairItem', keypairItem.publicKey.toBase58())
                const associatedUser = getAssociatedTokenAddressSync(mint, keypairItem.publicKey)
                try {
                    await getAccount(this.connection, associatedUser, commitment);
                } catch (e) {
                    if (this.associatedUsers.includes(associatedUser.toBase58()) == false) {
                        console.log(i, j, 'adding ata...')
                        inxList.push(
                            createAssociatedTokenAccountInstruction(
                                splitedKeypairArray[0][0].publicKey,
                                associatedUser,
                                keypairItem.publicKey,
                                mint
                            )
                        );
                        this.associatedUsers.push(associatedUser.toBase58());
                    }
                }

                const bondingCurveAccount = await this.getBondingCurveAccount(
                    this.GLOBAL_MINT,
                    commitment
                );

                if (!bondingCurveAccount) {
                    return {
                        Err: {
                            message: 'bonding curve account error'
                        }
                    }
                }

                console.log('splitedAmountArray[i][j]', splitedAmountArray[i][j])
                const buyAmount = bondingCurveAccount.getBuyPrice(splitedAmountArray[i][j]);

                const buyAmountWithSlippage = calculateWithSlippageBuy(
                    splitedAmountArray[i][j],
                    slippageBasisPoints
                );

                console.log(i, j, 'buying...', buyAmount, buyAmountWithSlippage)
                const inx = await this.program.methods
                    .buy(new BN((buyAmount).toString()).div(new BN(10)).mul(new BN(9)), new BN(buyAmountWithSlippage.toString()))
                    .accounts({
                        feeRecipient: globalAccount.feeRecipient,
                        mint: mint,
                        associatedBondingCurve,
                        associatedUser,
                        user: splitedKeypairArray[i][j].publicKey,
                    })
                    .instruction()

                inxList.push(inx)
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

    async CreateBatchAta(
        creator: Array<Keypair>,
        mint: PublicKey,
        lutAddress: PublicKey,
        commitment: Commitment = commitmentType.Confirmed,
        finality: Finality = commitmentType.Finalized
    ) {
        const payer = creator[0]

        const keypairList = chunkArray(creator, 12)
        for (const [i, array] of keypairList.entries()) {
            const inxList: Array<TransactionInstruction> = []
            for (const [j, item] of array.entries()) {
                const associatedUser = getAssociatedTokenAddressSync(mint, item.publicKey)
                try {
                    await getAccount(this.connection, associatedUser, commitment);
                } catch (e) {
                    inxList.push(
                        createAssociatedTokenAccountInstruction(
                            payer.publicKey,
                            associatedUser,
                            item.publicKey,
                            mint
                        )
                    )
                }

            }

            const latestBlockhash = await this.connection.getLatestBlockhash('finalized');
            const lookupTable = (await this.connection.getAddressLookupTable(lutAddress)).value;

            if (lookupTable == null) {
                console.error('lookup table creation failed')
                return
            }

            const msgV0 = new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: inxList
            }).compileToV0Message([lookupTable]);

            const ataCreationVTx = new VersionedTransaction(msgV0);
            ataCreationVTx.sign([payer])

            const sim = await this.connection.simulateTransaction(ataCreationVTx, { sigVerify: true })
            console.log('sim result', sim)
            const sig = await this.connection.sendTransaction(ataCreationVTx)
            const confirm = await this.connection.confirmTransaction(sig)
            console.log(sig)
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
            .create(name, symbol, uri)
            .accounts({
                mint: mint.publicKey,
                associatedBondingCurve: associatedBondingCurve,
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
        commitment: Commitment = commitmentType.Confirmed,
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
                        console.log("completeEvent", event, slot, signature);
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
