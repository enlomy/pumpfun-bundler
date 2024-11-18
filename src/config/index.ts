import 'dotenv/config'
import { Connection, Keypair, PublicKey } from "@solana/web3.js"
import bs58 from 'bs58'

export const mainKeypairHex = process.env.MAIN_KEYPAIR_HEX!
export const mainKeypair = Keypair.fromSecretKey(bs58.decode(mainKeypairHex))
export const solanaRpcUrl = process.env.MAIN_RPC_URL!
export const solanaWssUrl = process.env.MAIN_WSS_URL!
export const solanaConnection = new Connection(solanaRpcUrl, { wsEndpoint: solanaWssUrl })
export const devRpcUrl = process.env.DEV_RPC_URL!
export const devWssUrl = process.env.DEV_WSS_URL!
export const devConnection = new Connection(devRpcUrl, { wsEndpoint: devWssUrl })
export const treasury = new PublicKey(process.env.TREASURY_WALLET!)
export enum commitmentType {
    Finalized = "finalized",
    Confirmed = "confirmed",
    Processed = "processed"
}
export const jitoFee = 1_000_000
export const treasuryFee = 1_000_000

export const systemProgram = new PublicKey('11111111111111111111111111111111')
export const eventAuthority = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1')
export const pumpFunProgram = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
export const rentProgram = new PublicKey('SysvarRent111111111111111111111111111111111')