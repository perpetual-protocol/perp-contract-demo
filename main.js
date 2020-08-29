const fetch = require("cross-fetch")
const {
  Contract,
  getDefaultProvider,
  Wallet,
  BigNumber,
  constants,
} = require("ethers")
const AmmArtifact = require("@perp/contract/build/contracts/Amm.json")
const ClearingHouseArtifact = require("@perp/contract/build/contracts/ClearingHouse.json")
const ClearingHouseViewerArtifact = require("@perp/contract/build/contracts/ClearingHouseViewer.json")
const Erc20Artifact = require("@perp/contract/build/contracts/ERC20Simple.json")
const { parseUnits, formatEther, formatUnits } = require("ethers/lib/utils")
require("dotenv").config()

// const LONG_POS = 0
const SHORT_POS = 1
const DEFAULT_DECIMALS = 18
const PNL_OPTION_SPOT_PRICE = 0
const SHORT_AMOUNT = "100"

async function waitTx(txReq) {
  return txReq.then(tx => tx.wait())
}

async function faucetUsdt(accountAddress) {
  const faucetApiKey = "da2-utofcisc6jeznn6girfsg5tcxe"
  const faucetUrl =
    "https://gch77tgjo5cxzpji2k44usurdu.appsync-api.ap-southeast-1.amazonaws.com/graphql"
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": faucetApiKey,
    },
    body: JSON.stringify({
      query: `mutation issue {issue(holderAddr:"${accountAddress}"){
                    txHash
                    amount
                }
            }`,
    }),
  }
  return fetch(faucetUrl, options)
}

async function setupEnv() {
  const metadataUrl = "https://metadata.perp.exchange/ethereum-kovan.json"
  const metadata = await fetch(metadataUrl).then(res => res.json())
  const provider = getDefaultProvider("kovan")
  const wallet = Wallet.fromMnemonic(process.env.MNEMONIC).connect(provider)
  console.log("wallet address", wallet.address)

  const clearingHouseAddr = metadata.contracts.ClearingHouse.address
  const clearingHouseViewerAddr = metadata.contracts.ClearingHouseViewer.address
  const ammAddr = metadata.contracts.ETHUSDT.address

  const amm = new Contract(ammAddr, AmmArtifact.abi, wallet)
  const clearingHouse = new Contract(
    clearingHouseAddr,
    ClearingHouseArtifact.abi,
    wallet,
  )
  const clearingHouseViewer = new Contract(
    clearingHouseViewerAddr,
    ClearingHouseViewerArtifact.abi,
    wallet,
  )

  const usdtAddress = await amm.quoteAsset()
  const usdt = new Contract(usdtAddress, Erc20Artifact.abi, wallet)
  console.log("usdt address", usdtAddress)

  return { amm, clearingHouse, usdt, wallet, clearingHouseViewer }
}

async function openPosition(clearingHouse, amm) {
  const quoteAssetAmount = {
    d: parseUnits(SHORT_AMOUNT, DEFAULT_DECIMALS),
  }
  const leverage = { d: parseUnits("2", DEFAULT_DECIMALS) }
  const minBaseAssetAmount = { d: "0" }
  await waitTx(
    clearingHouse.openPosition(
      amm.address,
      SHORT_POS,
      quoteAssetAmount,
      leverage,
      minBaseAssetAmount,
    ),
  )
}

async function printInfo(clearingHouseViewer, amm, wallet) {
  console.log("getting information")
  const position = await clearingHouseViewer.getPersonalPositionWithFundingPayment(
    amm.address,
    wallet.address,
  )
  const pnl = await clearingHouseViewer.getUnrealizedPnl(
    amm.address,
    wallet.address,
    BigNumber.from(PNL_OPTION_SPOT_PRICE),
  )

  console.log(
    "- current position",
    formatUnits(position.size.d, DEFAULT_DECIMALS),
  )
  console.log("- pnl", formatUnits(pnl.d, DEFAULT_DECIMALS))
}

async function main() {
  const {
    amm,
    clearingHouse,
    usdt,
    wallet,
    clearingHouseViewer,
  } = await setupEnv()

  // get ETH & USDT balance
  const ethBalance = await wallet.getBalance()
  let usdtBalance = await usdt.balanceOf(wallet.address)
  const usdtDecimals = await usdt.decimals()

  // if no USDT, faucet to get more USDT
  while (!usdtBalance.gt(0)) {
    // faucet USDT
    console.log("faucet USDT")
    await faucetUsdt(wallet.address)
    usdtBalance = await usdt.balanceOf(wallet.address)
  }

  console.log(`eth balance ${formatEther(ethBalance)} ETH`)
  console.log(`usdt balance ${formatUnits(usdtBalance, usdtDecimals)} USDT`)

  // approve USDT
  const allowance = await usdt.allowance(wallet.address, clearingHouse.address)
  if (allowance.lt(parseUnits(SHORT_AMOUNT, DEFAULT_DECIMALS))) {
    console.log("approving all tokens for clearing house")
    await waitTx(usdt.approve(clearingHouse.address, constants.MaxUint256))
  }

  console.log("opening position")
  await openPosition(clearingHouse, amm)
  await printInfo(clearingHouseViewer, amm, wallet)

  console.log("closing position")
  await waitTx(clearingHouse.closePosition(amm.address))
  await printInfo(clearingHouseViewer, amm, wallet)
}

main()
