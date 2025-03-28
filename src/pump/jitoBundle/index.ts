import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import base58 from "bs58";
import axios, { AxiosError } from "axios";
import { commitmentType, JITO_FEE, solanaConnection, treasury, TREASURY_FEE, TREASURY_MODE } from "../../config";

export const jitoSellBundle = async (transactions: VersionedTransaction[], payer: Keypair) => {
  // shortening codebase ...
}

export const jitoPumpBundle = async (preTx: Transaction, signers: Keypair[], transactions: VersionedTransaction[], payer: Keypair) => {
  // shortening codebase ...
}




