#!/usr/bin/env node
import { program } from 'commander';
import * as anchor from '@project-serum/anchor';
import idl from "./idl/candy_machine.json";
import {Idl, Program, ProgramAccount} from "@project-serum/anchor";
import fs from "fs";
import {MintLayout, Token, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, AccountInfo} from '@solana/spl-token';
import {
    Blockhash,
    Commitment,
    Connection, FeeCalculator,
    Keypair,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY, Transaction,
    TransactionInstruction
} from "@solana/web3.js";

program.version("0.1.0");

const candyMachineProgramID = new anchor.web3.PublicKey(
    'cndyAnrLdpjq1Ssp1z8xxDsB8dxe7u4HL5Nxi2K5WXZ',
);

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
);

const configArrayStart =
    32 + // authority
    4 +
    6 + // uuid + u32 len
    4 +
    10 + // u32 len + symbol
    2 + // seller fee basis points
    1 +
    4 +
    5 * 34 + // optional + u32 len + actual vec
    8 + //max supply
    1 + //is mutable
    1 + // retain authority
    4; // max number of lines;
const configLineSize = 4 + 32 + 4 + 200;

const unpackConfigItem = (i: number, data: Buffer) : [string, string] =>{
        const thisSlice = data.slice(
            configArrayStart + 4 + configLineSize * i,
            configArrayStart + 4 + configLineSize * (i + 1),
        );
        const name = fromUTF8Array([...thisSlice.slice(4, 36)]);
        const uri = fromUTF8Array([...thisSlice.slice(40, 240)]);

        return [name, uri];
}

export function fromUTF8Array(data: number[]) {
    // array of bytes
    let str = '',
        i;

    for (i = 0; i < data.length; i++) {
        const value = data[i];

        if (value < 0x80) {
            str += String.fromCharCode(value);
        } else if (value > 0xbf && value < 0xe0) {
            str += String.fromCharCode(((value & 0x1f) << 6) | (data[i + 1] & 0x3f));
            i += 1;
        } else if (value > 0xdf && value < 0xf0) {
            str += String.fromCharCode(
                ((value & 0x0f) << 12) |
                ((data[i + 1] & 0x3f) << 6) |
                (data[i + 2] & 0x3f),
            );
            i += 2;
        } else {
            // surrogate pair
            const charCode =
                (((value & 0x07) << 18) |
                    ((data[i + 1] & 0x3f) << 12) |
                    ((data[i + 2] & 0x3f) << 6) |
                    (data[i + 3] & 0x3f)) -
                0x010000;

            str += String.fromCharCode(
                (charCode >> 10) | 0xd800,
                (charCode & 0x03ff) | 0xdc00,
            );
            i += 3;
        }
    }

    return str;
}

const getTokenWallet = async function (wallet: PublicKey, mint: PublicKey) {
    return (
        await PublicKey.findProgramAddress(
            [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
            ASSOCIATED_TOKEN_PROGRAM_ID,
        )
    )[0];
};

const getMetadata = async (
    mint: anchor.web3.PublicKey,
): Promise<anchor.web3.PublicKey> => {
    return (
        await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from('metadata'),
                TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                mint.toBuffer(),
            ],
            TOKEN_METADATA_PROGRAM_ID,
        )
    )[0];
};

const getMasterEdition = async (
    mint: anchor.web3.PublicKey,
): Promise<anchor.web3.PublicKey> => {
    return (
        await anchor.web3.PublicKey.findProgramAddress(
            [
                Buffer.from('metadata'),
                TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                mint.toBuffer(),
                Buffer.from('edition'),
            ],
            TOKEN_METADATA_PROGRAM_ID,
        )
    )[0];
};

export function createAssociatedTokenAccountInstruction(
    associatedTokenAddress: PublicKey,
    payer: PublicKey,
    walletAddress: PublicKey,
    splTokenMintAddress: PublicKey,
) {
    const keys = [
        {
            pubkey: payer,
            isSigner: true,
            isWritable: true,
        },
        {
            pubkey: associatedTokenAddress,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: walletAddress,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: splTokenMintAddress,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: SYSVAR_RENT_PUBKEY,
            isSigner: false,
            isWritable: false,
        },
    ];
    return new TransactionInstruction({
        keys,
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        data: Buffer.from([]),
    });
}

interface BlockhashAndFeeCalculator {
    blockhash: Blockhash;
    feeCalculator: FeeCalculator;
}

program.command("search")
    .argument('<pattern>', "The pattern used to identify candy machine configs")
    .option('-k, --keypair <path>', 'Solana wallet')
    .option('-u, --url <url>', 'rpc url e.g. https://api.devnet.solana.com')
    .action(async (pattern, options) => {
        const { keypair, url } = options;

        const walletKey = anchor.web3.Keypair.fromSecretKey(
            new Uint8Array(JSON.parse(fs.readFileSync(keypair).toString())),
        );

        const connection = new anchor.web3.Connection(url);
        const walletWrapper = new anchor.Wallet(walletKey);
        const provider = new anchor.Provider(connection, walletWrapper, {
            preflightCommitment: 'recent',
        });
        const candyMachineProgram = new Program(idl as Idl, candyMachineProgramID, provider);

        const candyMachines = await candyMachineProgram.account.candyMachine.all();
        const configPublicKeys = candyMachines.map(candyMachine => candyMachine.account.config);

        let configBuffers : any[] = [];
        let configsFetched = 0;
        const chunkSize = 99;
        console.log(`Number of configs ${configPublicKeys.length}`);
        while (configsFetched < configPublicKeys.length) {
            console.log(`Fetching configs ${configsFetched} through ${configsFetched + chunkSize}`);

            const nextConfigBuggers = await connection.getMultipleAccountsInfo(configPublicKeys.slice(configsFetched, chunkSize));
            configBuffers = [...configBuffers, ...nextConfigBuggers];
            configsFetched += chunkSize;

            const sleepDuration = 1000;
            console.log(`Sleeping for ${sleepDuration} ms to avoid rate limit`)
            await new Promise(r => setTimeout(r, sleepDuration));
        }

        const configMap = configBuffers.reduce((map, configBuffer) => {
            if (configBuffer?.data) {
                const config : any = candyMachineProgram.coder.accounts.decode("Config", configBuffer?.data);
                map.set(config.data.uuid, configBuffer);
            }
            return map;
        }, new Map());

        for (let candyMachine of candyMachines) {
            const numberOfItems = candyMachine.account.data.itemsAvailable;
            const configuuid = candyMachine.account.config.toBase58().slice(0, 6);
            const config = configMap.get(configuuid);

            if (!config || !config.data) {
                continue;
            }

            for (let i = 0; i < numberOfItems; i++) {
                const [name, uri] = unpackConfigItem(i, config.data);

                if (name.match(new RegExp(pattern))) {
                    console.log(`Match!`);
                    console.log(`Name: ${name}`);
                    console.log(`Uri: ${uri}`);
                    console.log(`Candy Machine Public Key: ${candyMachine.publicKey.toString()}`);
                }
            }
        }
    });

program.command("wen")
    .argument('<candy-machine>', "Candy machine account to fetch")
    .option('-k, --keypair <path>', 'Solana wallet')
    .option('-u, --url <url>', 'rpc url e.g. https://api.devnet.solana.com')
    .action(async (candyMachinePublicKeyString, options) => {
        const { keypair, url } = options;
        const candyMachinePublicKey = new anchor.web3.PublicKey(candyMachinePublicKeyString);

        const walletKey = anchor.web3.Keypair.fromSecretKey(
            new Uint8Array(JSON.parse(fs.readFileSync(keypair).toString())),
        );

        const connection = new anchor.web3.Connection(url);
        const walletWrapper = new anchor.Wallet(walletKey);
        const provider = new anchor.Provider(connection, walletWrapper, {
            preflightCommitment: 'recent',
        });
        const candyMachineProgram = new Program(idl as Idl, candyMachineProgramID, provider);

        const candyMachine : any = await candyMachineProgram.account.candyMachine.fetch(
            candyMachinePublicKey
        );

        if (candyMachine) {
            if (candyMachine.data.goLiveDate) {
                const date = new Date(candyMachine.data.goLiveDate.toNumber() * 1000);
                console.log(date.toString());
            } else {
                console.log(`Candy machine ${candyMachinePublicKeyString} does noot have live date`);
            }
        } else {
            console.error(`Candy machine ${candyMachinePublicKeyString} doesn't exist`);
        }
    });

program.command("mint")
    .argument('<candy-machine>', "Candy machine account to mint for")
    .option('-k, --keypair <path>', 'Solana wallet')
    .option('-u, --url <url>', 'rpc url e.g. https://api.devnet.solana.com')
    .action(async (candyMachinePublicKeyString, options) => {
        const { keypair, url } = options;
        const candyMachinePublicKey = new anchor.web3.PublicKey(candyMachinePublicKeyString);
        const walletKey = anchor.web3.Keypair.fromSecretKey(
            new Uint8Array(JSON.parse(fs.readFileSync(keypair).toString())),
        );

        const connection = new anchor.web3.Connection(url);
        const walletWrapper = new anchor.Wallet(walletKey);
        const provider = new anchor.Provider(connection, walletWrapper, {
            preflightCommitment: 'recent',
        });
        const candyMachineProgram = new Program(idl as Idl, candyMachineProgramID, provider);

        const candyMachine : any = await candyMachineProgram.account.candyMachine.fetch(
            candyMachinePublicKey
        );

        if (!candyMachine.data.goLiveDate) {
            console.error(`Candy machine ${candyMachinePublicKeyString} does not have live date yet`);
            return;
        }

        const liveDateMillisecondTimestamp = candyMachine.data.goLiveDate.toNumber() * 1000;
        const liveDate = new Date(liveDateMillisecondTimestamp);
        console.log(`Candy machine live date: ${liveDate.toString()}`);
        let currentTimestamp = Date.now();
        const todayDate = new Date();
        console.log(`Today's date: ${todayDate.toString()}`);

        const itemsAvailable = candyMachine.data.itemsAvailable;
        console.log(`Items available: ${itemsAvailable}`);
        const itemsRedeemed = candyMachine.itemsRedeemed;
        console.log(`Items redeemed: ${itemsRedeemed}`);

        if (itemsRedeemed >= itemsAvailable) {
            console.log("All items have been redeemed");
            return;
        }

        const mint = anchor.web3.Keypair.generate();
        const metadata = await getMetadata(mint.publicKey);
        const masterEdition = await getMasterEdition(mint.publicKey);
        const config : anchor.web3.PublicKey = candyMachine.config;
        const token = await getTokenWallet(walletKey.publicKey, mint.publicKey);
        const mintNFT = async () : Promise<string> => {
            return await candyMachineProgram.rpc.mintNft({
                accounts: {
                    config: config,
                    candyMachine: candyMachinePublicKey,
                    payer: walletKey.publicKey,
                    //@ts-ignore
                    wallet: candyMachine.wallet,
                    mint: mint.publicKey,
                    metadata,
                    masterEdition,
                    mintAuthority: walletKey.publicKey,
                    updateAuthority: walletKey.publicKey,
                    tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                    clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
                },
                signers: [mint, walletKey],
                instructions: [
                    anchor.web3.SystemProgram.createAccount({
                        fromPubkey: walletKey.publicKey,
                        newAccountPubkey: mint.publicKey,
                        space: MintLayout.span,
                        lamports: await provider.connection.getMinimumBalanceForRentExemption(
                            MintLayout.span,
                        ),
                        programId: TOKEN_PROGRAM_ID,
                    }),
                    Token.createInitMintInstruction(
                        TOKEN_PROGRAM_ID,
                        mint.publicKey,
                        0,
                        walletKey.publicKey,
                        walletKey.publicKey,
                    ),
                    createAssociatedTokenAccountInstruction(
                        token,
                        walletKey.publicKey,
                        walletKey.publicKey,
                        mint.publicKey,
                    ),
                    Token.createMintToInstruction(
                        TOKEN_PROGRAM_ID,
                        mint.publicKey,
                        token,
                        walletKey.publicKey,
                        [],
                        1,
                    ),
                ],
            });
        }

        const fiveHundredMs = 500;
        const intervalId = setInterval(async () => {
            currentTimestamp = Date.now();
            const millisecondsUntilDrop = liveDateMillisecondTimestamp - currentTimestamp;
            console.log("Time until drop:", millisecondsUntilDrop / 60000, "minutes");
            if (currentTimestamp - fiveHundredMs >= liveDateMillisecondTimestamp) {
                console.log("Five ms until the drop");
                try {
                    const tx = await mintNFT();
                    console.log(`Success! Tx: ${tx}`);
                } catch (e) {
                    console.log(e);
                    console.log("Let's try again");
                }
            }
        }, 500);
    });

program.parse(process.argv);