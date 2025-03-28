import bs58 from "bs58";
import { Result, PriorityFee, TransactionResult } from "./types";
import {
  Commitment,
  ComputeBudgetProgram,
  Connection,
  Finality,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  VersionedTransactionResponse,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { commitmentType, LUT_FEE, MAIN_WALLET_FEE, solanaConnection, SUB_WALLET_FEE } from "../../config";
import { publicKey } from "@project-serum/anchor/dist/cjs/utils";
// import { commitmentType } from "../../../config/contant";
// import { solanaConnection } from "../../../config/env";

export const calcNonDecimalValue = (
  value: number,
  decimals: number
): number => {
  return Math.trunc(value * Math.pow(10, decimals));
};

export const calcDecimalValue = (value: number, decimals: number): number => {
  return value / Math.pow(10, decimals);
};

export const getKeypairFromStr = (str: string): Keypair | null => {
  try {
    return Keypair.fromSecretKey(Uint8Array.from(bs58.decode(str)));
  } catch (error) {
    return null;
  }
};

export const getNullableResutFromPromise = async <T>(
  value: Promise<T>,
  opt?: { or?: T; logError?: boolean }
): Promise<T | null> => {
  return value.catch((error) => {
    if (opt) console.log({ error });
    return opt?.or != undefined ? opt.or : null;
  });
};

export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const createLookupTable = async (
  solanaConnection: Connection,
  signer: Keypair,
  addresses: PublicKey[] = []
): Promise<Result<{ lookupTable: PublicKey }, string>> => {
  try {
    const slot = await solanaConnection.getSlot();

    addresses.push(AddressLookupTableProgram.programId);
    console.log('lut addresses counts', addresses.length);
    const [lookupTableInst, lookupTableAddress] =
      AddressLookupTableProgram.createLookupTable({
        authority: signer.publicKey,
        payer: signer.publicKey,
        recentSlot: slot - 10,
      });

    for (let i = 0; i < addresses.length; i += 30) {
      const initAddressList = addresses.slice(
        i,
        Math.min(i + 30, addresses.length)
      );
      const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: signer.publicKey,
        authority: signer.publicKey,
        lookupTable: lookupTableAddress,
        addresses: [...initAddressList],
      });

      const blockhash = await solanaConnection
        .getLatestBlockhash()
        .then((res) => res.blockhash);

      const instructions: Array<TransactionInstruction> = [];
      if (i == 0) instructions.push(lookupTableInst);
      instructions.push(extendInstruction);
      const messageV0 = new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: blockhash,
        instructions: [...instructions],
      }).compileToV0Message();

      const vtx = new VersionedTransaction(messageV0);
      vtx.sign([signer]);

      const sim = await solanaConnection.simulateTransaction(vtx, { sigVerify: true })
      console.log(sim)

      const sig = await solanaConnection.sendTransaction(vtx);
      const confirm = await solanaConnection.confirmTransaction(
        sig,
        commitmentType.Finalized
      );
      console.log("lut sig", sig);
    }

    return { Ok: { lookupTable: lookupTableAddress } };
  } catch (err) {
    console.log("look up table creation error", err);

    return { Err: (err as any).toString() };
  }
};

export const deactiveLookupTable = async (
  solanaConnection: Connection,
  signer: Keypair,
  payer?: Keypair
) => {
  const res = await solanaConnection.getProgramAccounts(
    AddressLookupTableProgram.programId,
    {
      filters: [
        {
          memcmp: {
            offset: 22,
            bytes: signer.publicKey.toBase58(),
          },
        },
      ],
    }
  );
  console.log(res.length)
  const instructions: Array<TransactionInstruction> = [];
  res.map((item) => {
    if (item.pubkey.toBase58() != "") {
      const closeInx = AddressLookupTableProgram.deactivateLookupTable({
        lookupTable: item.pubkey, // Address of the lookup table to close
        authority: signer.publicKey, // Authority to close the LUT
      });
      instructions.push(closeInx);
    }
  });

  const count = 25
  for (let i = 0; i < instructions.length; i += count) {
    const blockhash = await solanaConnection
      .getLatestBlockhash()
      .then((res) => res.blockhash);

    const instructionsList = instructions.slice(
      i,
      Math.min(i + count, instructions.length)
    );
    const messageV0 = new TransactionMessage({
      payerKey: payer ? payer.publicKey : signer.publicKey,
      recentBlockhash: blockhash,
      instructions: instructionsList,
    }).compileToV0Message();

    const vtx = new VersionedTransaction(messageV0);
    const signers = payer ? [payer, signer] : [signer]
    vtx.sign(signers);

    const sim = await solanaConnection.simulateTransaction(vtx);
    console.log(sim);
    if (!sim.value.err) {
      const sig = await solanaConnection.sendTransaction(vtx);
      const confirm = await solanaConnection.confirmTransaction(sig);
      console.log('lut deactive sig', sig)
    }
  }
};

export const closeLookupTable = async (
  solanaConnection: Connection,
  signer: Keypair,
  payer?: Keypair
) => {
  const res = await solanaConnection.getProgramAccounts(
    AddressLookupTableProgram.programId,
    {
      filters: [
        {
          memcmp: {
            offset: 22,
            bytes: signer.publicKey.toBase58(),
          },
        },
      ],
    }
  );

  const instructions: Array<TransactionInstruction> = [];
  res.map((item) => {
    if (item.pubkey.toBase58() != "") {
      const closeInx = AddressLookupTableProgram.closeLookupTable({
        lookupTable: item.pubkey, // Address of the lookup table to close
        authority: signer.publicKey, // Authority to close the LUT
        recipient: payer ? payer.publicKey : signer.publicKey, // Recipient of the reclaimed rent balance
      });
      instructions.push(closeInx);
    }
  });

  for (let i = 0; i < instructions.length; i += 25) {
    const blockhash = await solanaConnection
      .getLatestBlockhash()
      .then((res) => res.blockhash);

    const instructionsList = instructions.slice(
      i,
      Math.min(i + 25, instructions.length)
    );
    const messageV0 = new TransactionMessage({
      payerKey: payer ? payer.publicKey : signer.publicKey,
      recentBlockhash: blockhash,
      instructions: instructionsList,
    }).compileToV0Message();

    const vtx = new VersionedTransaction(messageV0);
    const signers = payer ? [payer, signer] : [signer]
    vtx.sign(signers);

    const sim = await solanaConnection.simulateTransaction(vtx);
    console.log(sim);

    const sig = await solanaConnection.sendTransaction(vtx);
    const confirm = await solanaConnection.confirmTransaction(sig);
    console.log('lut close sig', sig)
  }
};

export const burnLUT = async (solanaConnection: Connection, signer: Keypair, payer?: Keypair) => {
  await deactiveLookupTable(solanaConnection, signer, payer)
  await sleep(300_000)
  await closeLookupTable(solanaConnection, signer, payer)
}

export const calculateWithSlippageBuy = (
  amount: bigint,
  basisPoints: bigint
) => {
  return amount + (amount * basisPoints) / BigInt(10000);
};

export const calculateWithSlippageSell = (
  amount: bigint,
  basisPoints: bigint
) => {
  return amount - (amount * basisPoints) / BigInt(10000);
};

export const sendTx = async (
  solanaConnection: Connection,
  tx: Transaction,
  payer: PublicKey,
  signers: Keypair[],
  priorityFees?: PriorityFee,
  commitment: Commitment = commitmentType.Confirmed,
  finality: Finality = commitmentType.Finalized
): Promise<TransactionResult> => {
  const newTx = new Transaction();

  if (priorityFees) {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: priorityFees.unitLimit,
    });

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFees.unitPrice,
    });
    newTx.add(modifyComputeUnits);
    newTx.add(addPriorityFee);
  }
  newTx.add(tx);
  const versionedTx = await buildVersionedTx(solanaConnection, payer, newTx);
  versionedTx.sign(signers);
  try {
    const sig = await solanaConnection.sendTransaction(versionedTx, {
      skipPreflight: false,
    });

    const txResult = await solanaConnection.confirmTransaction(sig);

    if (txResult.value.err) {
      return {
        success: false,
        error: "Transaction failed",
      };
    }
    return {
      success: true,
      signature: sig,
    };
  } catch (e) {
    console.error(e);

    if (e instanceof SendTransactionError) {
      e as SendTransactionError;
    }

    return {
      error: e,
      success: false,
    };
  }
};

export const buildTx = async (
  solanaConnection: Connection,
  tx: Transaction,
  payer: PublicKey,
  signers: Keypair[],
  priorityFees?: PriorityFee,
  commitment: Commitment = commitmentType.Confirmed,
  finality: Finality = commitmentType.Finalized
): Promise<VersionedTransaction> => {
  const newTx = new Transaction();

  if (priorityFees) {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: priorityFees.unitLimit,
    });

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFees.unitPrice,
    });
    newTx.add(modifyComputeUnits);
    newTx.add(addPriorityFee);
  }
  newTx.add(tx);
  const versionedTx = await buildVersionedTx(
    solanaConnection,
    payer,
    newTx,
    commitment
  );
  versionedTx.sign(signers);
  return versionedTx;
};

export const buildVersionedTx = async (
  solanaConnection: Connection,
  payer: PublicKey,
  tx: Transaction,
  commitment: Commitment = commitmentType.Finalized
): Promise<VersionedTransaction> => {
  const blockHash = (await solanaConnection.getLatestBlockhash(commitment)).blockhash;

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockHash,
    instructions: tx.instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
};

export const getTxDetails = async (
  solanaConnection: Connection,
  sig: string,
  commitment: Commitment = commitmentType.Confirmed,
  finality: Finality = commitmentType.Finalized
): Promise<VersionedTransactionResponse | null> => {
  const latestBlockHash = await solanaConnection.getLatestBlockhash(commitment);
  await solanaConnection.confirmTransaction(
    {
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: sig,
    },
    commitment
  );

  return solanaConnection.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: finality,
  });
};

export const getRandomInt = (min: number, max: number): number => {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min; // The maximum is inclusive, the minimum is inclusive
};

export const printSOLBalance = async (
  solanaConnection: Connection,
  pubKey: PublicKey,
  info: string = ""
) => {
  const balance = await solanaConnection.getBalance(pubKey);
  console.log(
    `${info ? info + " " : ""}${pubKey.toBase58()}:`,
    balance / LAMPORTS_PER_SOL,
    `SOL`
  );
};

export const getSPLBalance = async (
  solanaConnection: Connection,
  mintAddress: PublicKey,
  pubKey: PublicKey,
  allowOffCurve: boolean = false
) => {
  try {
    const ata = getAssociatedTokenAddressSync(
      mintAddress,
      pubKey,
      allowOffCurve
    );
    const balance = await solanaConnection.getTokenAccountBalance(ata, "processed");
    return balance.value.uiAmount;
  } catch (e) { }
  return null;
};

export const printSPLBalance = async (
  solanaConnection: Connection,
  mintAddress: PublicKey,
  user: PublicKey,
  info: string = ""
) => {
  const balance = await getSPLBalance(solanaConnection, mintAddress, user);
  if (balance === null) {
    console.log(
      `${info ? info + " " : ""}${user.toBase58()}:`,
      "No Account Found"
    );
  } else {
    console.log(`${info ? info + " " : ""}${user.toBase58()}:`, balance);
  }
};

export const baseToValue = (base: number, decimals: number): number => {
  return base * Math.pow(10, decimals);
};

export const valueToBase = (value: number, decimals: number): number => {
  return value / Math.pow(10, decimals);
};

export const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
  const result: T[][] = [];

  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    result.push(chunk);
  }

  return result;
};


export const distributeSol = async (kyepair: Keypair, pubkeyList: PublicKey[], amount: number) => {
  const tx = new Transaction()
  for (const item of pubkeyList) {
    const bal = await solanaConnection.getBalance(item)
    if (bal > amount) continue
    tx.add(
      SystemProgram.transfer({
        fromPubkey: kyepair.publicKey,
        toPubkey: item,
        lamports: Math.round(amount - bal)
      })
    )
  }

  if (tx.instructions.length == 0) return

  const blockhash = (await solanaConnection.getLatestBlockhash('finalized')).blockhash
  console.log(blockhash)
  const messageV0 = new TransactionMessage({
    payerKey: kyepair.publicKey,
    recentBlockhash: blockhash,
    instructions: tx.instructions,
  }).compileToV0Message();
  const vtx = new VersionedTransaction(messageV0);
  vtx.sign([kyepair])
  const sim = await solanaConnection.simulateTransaction(vtx, { sigVerify: true })
  if (!sim.value.err) {
    const sig = await solanaConnection.sendTransaction(vtx)
    const confirm = await solanaConnection.confirmTransaction(sig)
    console.log(sig)
  } else {
    console.log(sim.value.err)
  }
}

export const validateBundle = async (mainWallet: PublicKey, amount: number, count: number) => {
  const balance = await solanaConnection.getBalance(mainWallet)
  const limit = MAIN_WALLET_FEE + LUT_FEE * Math.ceil(count / 5) + count * (SUB_WALLET_FEE + amount * 1.1)
  return balance / LAMPORTS_PER_SOL > limit
}

export const gatherSol = async (wallets: Keypair[], payer: Keypair) => {
  const inx: TransactionInstruction[] = []
  const signers: Keypair[] = []
  for (const wallet of wallets) {
    const balance = await solanaConnection.getBalance(wallet.publicKey);
    if (balance > 0) {
      console.log(wallet.publicKey.toBase58(), balance)
      inx.push(SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: payer.publicKey,
        lamports: balance,
      }))
      signers.push(wallet)
    }
  }
  const limit = 7
  for (let i = 0; i < inx.length; i += limit) {
    const inxList = inx.slice(i, Math.min(i + limit, inx.length));
    const signersList = signers.slice(i, Math.min(i + limit, signers.length));
    if (inxList.length == 0) break;

    const blockhash = await solanaConnection
      .getLatestBlockhash()
      .then((res) => res.blockhash);
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        // ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 }),
        ...inxList,
      ],
    }).compileToV0Message();

    const vtx = new VersionedTransaction(messageV0);
    vtx.sign([...signersList, payer]);

    const sim = await solanaConnection.simulateTransaction(vtx);
    console.log(sim)

    if (sim.value.err) {
      console.log(sim.value.err)
      continue
    }
    const sig = await solanaConnection.sendTransaction(vtx);
    
    const confirm = await solanaConnection.confirmTransaction(sig);
    console.log(sig)
  }
}
