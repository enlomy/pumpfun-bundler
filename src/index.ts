import bs58 from 'bs58'
import fs from 'fs'
import { AnchorProvider } from "@coral-xyz/anchor";
import { mainKeypair, solanaConnection } from "./config";
import { PumpFunSDK } from "./pump";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { openAsBlob, existsSync } from "fs";
import path from "path";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

const main = async () => {
    const wallet = new NodeWallet(mainKeypair)
    const provider = new AnchorProvider(solanaConnection, wallet, {
        commitment: "finalized",
    });

    const imageName = 'tensorian.png'

    const uploadFolder = path.join(process.cwd(), '/src/image')
    const imagePath = path.join(uploadFolder, imageName)

    if (!existsSync(imagePath)) {
        console.error('image not exist')
        return
    }

    const image = await openAsBlob(imagePath)

    const tokenMetadata = {
        name: 'en1omy',
        symbol: 'EMY',
        description: 'This is pump.fun token created by enlomy using customized pump fun sdk',
        file: image,
        twitter: 'https://x.com/en1omy',
        telegram: 'https://t.me/enlomy',
        website: 'https://enlomy.com',
    }

    const sdk = new PumpFunSDK(provider)

    const data: Array<{ wallet: string, amount: number }> = JSON.parse(fs.readFileSync('data.json', 'utf-8'))
    const keypairList = data.map(item => Keypair.fromSecretKey(bs58.decode(item.wallet)))
    const amountList = data.map(item => BigInt(item.amount * LAMPORTS_PER_SOL))

    const mint = Keypair.generate()
    console.log(mint.publicKey.toBase58())

    const mintResult = await sdk.createAndBatchBuy(keypairList, amountList, tokenMetadata, mint)
    console.log(mintResult)
}

main()