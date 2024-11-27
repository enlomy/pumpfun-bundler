import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import base58 from "bs58";
import axios, { AxiosError } from "axios";
import { jitoFee, treasuryFee, treasury, solanaConnection, commitmentType } from "../../config";

export const jitoBundle = async (transactions: VersionedTransaction[], payer: Keypair, feepay: boolean = true) => {
  console.log('Starting Jito Bundling... Tx counts:', transactions.length);

  const tipAccounts = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  ];
  const jitoFeeWallet = new PublicKey(tipAccounts[Math.floor(tipAccounts.length * Math.random())])

  try {
    console.log(`Pay fee: ${jitoFee / LAMPORTS_PER_SOL} sol to ${jitoFeeWallet.toBase58()}`)

    const latestBlockhash = await solanaConnection.getLatestBlockhash()

    const transactionInstruction: Array<TransactionInstruction> = [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: jitoFeeWallet,
        lamports: jitoFee,
      })
    ]

    if (feepay) {
      transactionInstruction.push(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: treasury,
          lamports: treasuryFee,
        }))
    }


    const jitTipTxFeeMessage = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: transactionInstruction,
    }).compileToV0Message()

    const jitoFeeTx = new VersionedTransaction(jitTipTxFeeMessage)
    jitoFeeTx.sign([payer]);

    const jitoFeeTxsignature = base58.encode(jitoFeeTx.signatures[0])
    const serializedjitoFeeTx = base58.encode(jitoFeeTx.serialize())
    const serializedTransactions = [serializedjitoFeeTx]
    for (let i = 0; i < transactions.length; i++) {
      const serializedTransaction = base58.encode(transactions[i].serialize())
      serializedTransactions.push(serializedTransaction)
    }


    const endpoints = [
      'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
      // 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
      // 'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
      // 'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
      // 'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
    ];

    let bundleId: string = "";
    const requests = endpoints.map(async (url) => {
      const res = await axios.post(url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [serializedTransactions],
      })

      bundleId = res.data.result;
      console.log('bundleId', bundleId)
      return res.data;
    }
    );

    console.log('Sending transactions to endpoints...');

    const results = await Promise.all(requests.map((req) => req.catch((e) => e)));
    console.log('results.length', results.length)

    const successfulResults = results.filter((result) => !(result instanceof Error));

    console.log('successfulResults.length', successfulResults.length)
    if (successfulResults.length > 0) {
      // console.log(`Successful response`);
      console.log(`Confirming jito transaction...`);
      const confirmation = await solanaConnection.confirmTransaction(
        {
          signature: jitoFeeTxsignature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        commitmentType.Confirmed,
      );

      console.log('confirmation', jitoFeeTxsignature)

      return { confirmed: !confirmation.value.err, jitoTxsignature: jitoFeeTxsignature, bundleId };
    } else {
      console.log(`No successful responses received for jito`);
    }

    return { confirmed: false };
  } catch (error) {

    if (error instanceof AxiosError) {
      console.log('Failed to execute jito transaction');
    }
    console.log('Error during transaction execution', error);
    return { confirmed: false };
  }
}


export const jitoExpertBundle = async (preTx: Transaction, signers: Keypair[], transactions: VersionedTransaction[], payer: Keypair, feepay: boolean = true) => {
  // shortening codebase ...
}




