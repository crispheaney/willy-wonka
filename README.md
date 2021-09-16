### Purpose

Mint candy machine NFTs from your CLI. Use your preferred rpc provider. Avoid rage quitting because the candy machine GUI fails.

### Installation

```shell
cd ts
yarn
tsc
npm link
```

### Use
1) Find the public key for the candy machine you want to mint
```shell
willy-wonka search -k /Users/crisp/.config/solana/id.json -u https://api.devnet.solana.com "pixel dude*"
```
2) Check when it drops
```shell
 willy-wonka wen -k /Users/crisp/.config/solana/id.json -u https://api.devnet.solana.com G5kxQtRjE9saZruweUbbwHhaJi4okRoxbGNQVrh94oCN
```
3) Start minting scripts ~X minutes before drop
```shell
willy-wonka mint -k /Users/crisp/.config/solana/id.json -u https://api.devnet.solana.com G5kxQtRjE9saZruweUbbwHhaJi4okRoxbGNQVrh94oCN
```
