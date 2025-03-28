import bs58 from 'bs58'
import path from "path";
import fs, { openAsBlob, existsSync } from "fs";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { mainKeypair, provider, solanaConnection, SUB_WALLET_FEE } from "./config";
import { PumpFunSDK } from "./pump";
import { burnLUT, distributeSol, gatherSol, sleep, validateBundle } from './pump/utils';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const createAndBatchBuy = async (count: number, amount: number, fileName?: string, mintPath?: string) => {
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

    let dataList: Array<string> = []
    let length: number
    if (fileName) {
        dataList = JSON.parse(fs.readFileSync(fileName, 'utf8'))
        length = dataList.length
    } else {
        for (let i = 0; i < count - 1; i++) {
            const mint = Keypair.generate()
            dataList.push(bs58.encode(mint.secretKey))
        }
        length = count
        const uniqueName = `data_${Date.now()}.json`
        console.log(uniqueName)
        fs.writeFileSync(uniqueName, JSON.stringify(dataList, null, 2))
    }

    const buyers = [mainKeypair, ...dataList.map((item) => Keypair.fromSecretKey(Uint8Array.from(bs58.decode(item))))]

    const possibility = await validateBundle(mainKeypair.publicKey, amount, length)

    if (!possibility) {
        console.log('Not enough balance')
        return
    }
    await distributeSol(mainKeypair, buyers.slice(1).map((item) => item.publicKey), (SUB_WALLET_FEE + amount * 1.1) * LAMPORTS_PER_SOL)

    const sdk = new PumpFunSDK(provider)

    let mint: Keypair
    if (mintPath) {
        mint = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(mintPath, 'utf8'))))
    } else {
        mint = Keypair.generate()
        fs.writeFileSync(`data_${mint.publicKey.toBase58()}.json`, JSON.stringify(Array.from(mint.secretKey)))
    }
    const buyAmountSol = buyers.map(() => BigInt(amount * LAMPORTS_PER_SOL))
    const mintResult = await sdk.createAndBatchBuy(mainKeypair, buyers, buyAmountSol, tokenMetadata, mint)

    console.log(mintResult)
}

const batchSell = async (fileName: string, mint: string, lutAddress: PublicKey) => {
    const sdk = new PumpFunSDK(provider)
    const dataList = JSON.parse(fs.readFileSync(fileName, 'utf8'))
    const wallets = dataList.map((item: string) => Keypair.fromSecretKey(Uint8Array.from(bs58.decode(item)))) as Array<Keypair>
    const walletList = [mainKeypair, ...wallets]
    const tokenAmount = await Promise.all(walletList.map(async (item) => {
        const balance = await solanaConnection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint), item.publicKey))
        return BigInt(balance.value.amount)
    }))

    console.log(walletList.length)
    const mintResult = await sdk.batchSell(mainKeypair, new PublicKey(mint), walletList, tokenAmount, lutAddress)
    console.log(mintResult)
    if (mintResult.success) {
        await sleep(10000)
        await gatherSol(wallets, mainKeypair)
    }
}

const withdrawAllSol = async (fileName: string) => {
    const dataList = JSON.parse(fs.readFileSync(fileName, 'utf8'))
    const wallets = dataList.map((item: string) => Keypair.fromSecretKey(Uint8Array.from(bs58.decode(item))))
    await gatherSol(wallets, mainKeypair)
}

const withdrawLUT = async () => {
    await burnLUT(solanaConnection, mainKeypair)
}
