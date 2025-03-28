import 'dotenv/config'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js"
import bs58 from 'bs58'
import { AnchorProvider } from '@coral-xyz/anchor'
import NodeWallet from '@coral-xyz/anchor/dist/cjs/nodewallet'

export const mainKeypairHex = process.env.MAIN_KEYPAIR_HEX!
export const mainKeypair = Keypair.fromSecretKey(bs58.decode(mainKeypairHex))
export const solanaRpcUrl = process.env.MAIN_RPC_URL!
export const solanaWssUrl = process.env.MAIN_WSS_URL!
export const solanaConnection = new Connection(solanaRpcUrl, { wsEndpoint: solanaWssUrl })
export const devRpcUrl = process.env.DEV_RPC_URL!
export const devWssUrl = process.env.DEV_WSS_URL!
export const devConnection = new Connection(devRpcUrl, { wsEndpoint: devWssUrl })
export const geyserRpc = process.env.GEYSER_RPC;
export const treasury = new PublicKey(process.env.TREASURY_WALLET!)
export const wallet = new NodeWallet(mainKeypair)
export const provider = new AnchorProvider(solanaConnection, wallet, {
    commitment: "finalized",
});
export enum commitmentType {
    Finalized = "finalized",
    Confirmed = "confirmed",
    Processed = "processed"
}
export const JITO_FEE = 1_000_000
export const TREASURY_FEE = Number(process.env.TREASURY_FEE!)
export const TREASURY_MODE = Boolean(process.env.TREASURY_MODE!)
export const MAIN_WALLET_FEE = 0.0015 + JITO_FEE / LAMPORTS_PER_SOL + (TREASURY_MODE ? TREASURY_FEE : 0)
export const LUT_FEE = 0.011
export const SUB_WALLET_FEE = 0.0022

export const data = []

export const systemProgram = new PublicKey('11111111111111111111111111111111')
export const eventAuthority = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1')
export const pumpFunProgram = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
export const rentProgram = new PublicKey('SysvarRent111111111111111111111111111111111')

export const JITO_TIP_ACC = [
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
]
