const fetch = require("cross-fetch")
const { Contract, Wallet, BigNumber, constants, providers } = require("ethers")
const AmmArtifact = require("@perp/contract/build/contracts/src/Amm.sol/Amm.json")
const ClearingHouseArtifact = require("@perp/contract/build/contracts/src/ClearingHouseViewer.sol/ClearingHouseViewer.json")
const RootBridgeArtifact = require("@perp/contract/build/contracts/src/bridge/ethereum/RootBridge.sol/RootBridge.json")
const ClientBridgeArtifact = require("@perp/contract/build/contracts/src/bridge/xDai/ClientBridge.sol/ClientBridge.json")
const CHViewerArtifact = require("@perp/contract/build/contracts/ClearingHouseViewer.json")
const Erc20TokenArtifact = require("@perp/contract/build/contracts/src/mock/ERC20Fake.sol/ERC20Fake.json")

const { parseUnits, formatEther, formatUnits } = require("ethers/lib/utils")
require("dotenv").config()

// const LONG_POS = 0
const SHORT_POS = 1
const DEFAULT_DECIMALS = 18
const USDC_DECIMALS = 6
const PNL_OPTION_SPOT_PRICE = 0
const SHORT_AMOUNT = "100"
const ACTION_DEPOSIT = 0
const ACTION_WITHDRAW = 1

const ABI_AMB_LAYER1 = [
  "event RelayedMessage(address indexed sender, address indexed executor, bytes32 indexed messageId, bool status)",
  "event AffirmationCompleted( address indexed sender, address indexed executor, bytes32 indexed messageId, bool status)",
]

const ABI_AMB_LAYER2 = [
  "event AffirmationCompleted( address indexed sender, address indexed executor, bytes32 indexed messageId, bool status)",
]

async function waitTx(txReq) {
  return txReq.then(tx => {
    console.log(`waiting tx ${tx.hash} ...`)
    return tx.wait(2)
  }) // wait 2 block for confirmation
}

async function faucetUsdc(accountAddress) {
  const faucetApiKey = "da2-h4xlnj33zvfnheevfgaw7datae"
  const appSyncId = "izc32tpa5ndllmbql57pcxluua"
  const faucetUrl = `https://${appSyncId}.appsync-api.ap-northeast-1.amazonaws.com/graphql`
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": faucetApiKey,
    },
    body: JSON.stringify({
      query: `mutation issue {issue(holderAddr:"${accountAddress}"){
                    txHashQuote
                    amountQuote
                }
            }`,
    }),
  }
  return fetch(faucetUrl, options)
}

async function setupEnv() {
  const metadataUrl = "https://metadata.perp.exchange/staging.json"
  const metadata = await fetch(metadataUrl).then(res => res.json())
  const xDaiUrl = "https://rpc.xdaichain.com/"
  const rinkebyUrl = `https://rinkeby.infura.io/v3/${process.env.INFURA_PROJECT_ID}`
  const layer1Provider = new providers.JsonRpcProvider(rinkebyUrl)
  const layer2Provider = new providers.JsonRpcProvider(xDaiUrl)
  const layer1Wallet = Wallet.fromMnemonic(process.env.MNEMONIC).connect(layer1Provider)
  const layer2Wallet = Wallet.fromMnemonic(process.env.MNEMONIC).connect(layer2Provider)
  console.log("wallet address", layer1Wallet.address)

  // layer 1 contracts
  const layer1BridgeAddr = metadata.layers.layer1.contracts.RootBridge.address
  const usdcAddr = metadata.layers.layer1.externalContracts.usdc
  const layer1AmbAddr = metadata.layers.layer1.externalContracts.ambBridgeOnEth

  const layer1Usdc = new Contract(usdcAddr, Erc20TokenArtifact.abi, layer1Wallet)
  const layer1Bridge = new Contract(layer1BridgeAddr, RootBridgeArtifact.abi, layer1Wallet)
  const layer1Amb = new Contract(layer1AmbAddr, ABI_AMB_LAYER1, layer1Wallet)

  // layer 2 contracts
  const layer2BridgeAddr = metadata.layers.layer2.contracts.ClientBridge.address
  const layer2AmbAddr = metadata.layers.layer2.externalContracts.ambBridgeOnXDai
  const xUsdcAddr = metadata.layers.layer2.externalContracts.usdc
  const clearingHouseAddr = metadata.layers.layer2.contracts.ClearingHouse.address
  const chViewerAddr = metadata.layers.layer2.contracts.ClearingHouseViewer.address
  const ammAddr = metadata.layers.layer2.contracts.ETHUSDC.address

  const layer2Usdc = new Contract(xUsdcAddr, Erc20TokenArtifact.abi, layer2Wallet)
  const amm = new Contract(ammAddr, AmmArtifact.abi, layer2Wallet)
  const clearingHouse = new Contract(clearingHouseAddr, ClearingHouseArtifact.abi, layer2Wallet)
  const clearingHouseViewer = new Contract(chViewerAddr, CHViewerArtifact.abi, layer2Wallet)
  const layer2Amb = new Contract(layer2AmbAddr, ABI_AMB_LAYER2, layer2Wallet)
  const layer2Bridge = new Contract(layer2BridgeAddr, ClientBridgeArtifact.abi, layer2Wallet)

  console.log("USDC address", usdcAddr)

  return {
    amm,
    clearingHouse,
    layer1Usdc,
    layer2Usdc,
    layer1Wallet,
    layer2Wallet,
    clearingHouseViewer,
    layer1Bridge,
    layer2Bridge,
    layer1Amb,
    layer2Amb,
  }
}

async function openPosition(clearingHouse, amm) {
  // openPosition requires more gas and somehow xdai node does not 
  // calculate correct gas limit, so we use fixed value here.
  const options = { gasLimit: 3_800_000 } 
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
      options
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

  console.log("- current position", formatUnits(position.size.d, DEFAULT_DECIMALS))
  console.log("- pnl", formatUnits(pnl.d, DEFAULT_DECIMALS))
}

async function printBalances(layer1Wallet, layer2Wallet, layer1Usdc, layer2Usdc) {
  // get ETH & USDC balance
  const ethBalance = await layer1Wallet.getBalance()
  const xDaiBalance = await layer2Wallet.getBalance()
  let layer1UsdcBalance = await layer1Usdc.balanceOf(layer1Wallet.address)
  let layer2UsdcBalance = await layer2Usdc.balanceOf(layer1Wallet.address)
  const layer1UsdcDecimals = await layer1Usdc.decimals()
  const layer2UsdcDecimals = await layer2Usdc.decimals()

  const outputs = [
    "balances",
    `- layer 1`,
    `  - ${formatEther(ethBalance)} ETH`,
    `  - ${formatUnits(layer1UsdcBalance, layer1UsdcDecimals)} USDC`,
    `- layer 2`,
    `  - ${formatEther(xDaiBalance)} xDAI`,
    `  - ${formatUnits(layer2UsdcBalance, layer2UsdcDecimals)} USDC`,
  ]
  console.log(outputs.join("\n"))
}

async function waitCrossChain(action, receipt, layer1Amb, layer2Amb) {
  let methodId
  let eventName
  let amb

  if (action === ACTION_DEPOSIT) {
    methodId = "0x482515ce" // UserRequestForAffirmation
    eventName = "AffirmationCompleted"
    amb = layer2Amb
  } else if (action === ACTION_WITHDRAW) {
    methodId = "0x520d2afd" // UserRequestForSignature
    eventName = "RelayedMessage"
    amb = layer1Amb
  } else {
    throw new Error("unknown action: " + action)
  }

  return new Promise(async (resolve, reject) => {
    if (receipt && receipt.logs) {
      const matched = receipt.logs.filter(log => log.topics[0].substr(0, 10) === methodId)
      if (matched.length === 0) {
        return reject("methodId not found: " + methodId)
      }
      const log = matched[0]
      const fromMsgId = log.topics[1]
      console.log("msgId from receipt", fromMsgId)
      amb.on(eventName, (sender, executor, toMsgId, status, log) => {
        console.log("got event", toMsgId)
        if (fromMsgId === toMsgId) {
          amb.removeAllListeners(eventName)
          resolve(log.transactionHash)
        }
      })
    } else {
      reject("receipt or log not found")
    }
  })
}

async function main() {
  const {
    amm,
    clearingHouse,
    layer1Usdc,
    layer2Usdc,
    layer1Wallet,
    layer2Wallet,
    clearingHouseViewer,
    layer1Bridge,
    layer2Bridge,
    layer1Amb,
    layer2Amb,
  } = await setupEnv()

  // get ETH & USDC balance
  let layer1UsdcBalance = await layer1Usdc.balanceOf(layer1Wallet.address)

  // if no USDC, faucet to get more USDC
  while (!layer1UsdcBalance.gt(0)) {
    console.log("faucet USDC")
    await faucetUsdc(layer1Wallet.address)
    layer1UsdcBalance = await layer1Usdc.balanceOf(layer1Wallet.address)
  }

  const amount = parseUnits(SHORT_AMOUNT, USDC_DECIMALS)

  await printBalances(layer1Wallet, layer2Wallet, layer1Usdc, layer2Usdc)

  // approve USDC
  const allowanceForBridge = await layer1Usdc.allowance(layer1Wallet.address, layer1Bridge.address)
  if (allowanceForBridge.lt(amount)) {
    console.log("approving all tokens for root bridge on layer 1")
    await waitTx(layer1Usdc.approve(layer1Bridge.address, constants.MaxUint256))
  }

  // deposit to layer 2
  console.log("depositing to layer 2")
  const depositAmount = { d: parseUnits(SHORT_AMOUNT, DEFAULT_DECIMALS) }
  const layer1Receipt = await waitTx(
    layer1Bridge.erc20Transfer(layer1Usdc.address, layer1Wallet.address, depositAmount),
  )
  console.log("waiting confirmation on layer 2")
  await waitCrossChain(ACTION_DEPOSIT, layer1Receipt, layer1Amb, layer2Amb)
  await printBalances(layer1Wallet, layer2Wallet, layer1Usdc, layer2Usdc)

  const allowanceForClearingHouse = await layer2Usdc.allowance(
    layer2Wallet.address,
    clearingHouse.address,
  )
  if (allowanceForClearingHouse.lt(amount)) {
    console.log("approving all tokens for clearing house on layer 2")
    await waitTx(layer2Usdc.approve(clearingHouse.address, constants.MaxUint256))
  }

  console.log("opening position")
  await openPosition(clearingHouse, amm)
  await printInfo(clearingHouseViewer, amm, layer2Wallet)

  console.log("closing position")
  await waitTx(clearingHouse.closePosition(amm.address, { d: "0" }))
  await printInfo(clearingHouseViewer, amm, layer2Wallet)

  // withdraw to layer 1
  console.log("approving all token for client bridge on layer 2")
  await waitTx(layer2Usdc.approve(layer2Bridge.address, constants.MaxUint256))

  console.log("withdraw 50 USDC from layer 2 to layer 1")
  const layer2Receipt = await waitTx(
    layer2Bridge.erc20Transfer(layer2Usdc.address, layer2Wallet.address, {
      d: parseUnits("50", DEFAULT_DECIMALS),
    }),
  )
  console.log("waiting confirmation on layer 1")
  await waitCrossChain(ACTION_WITHDRAW, layer2Receipt, layer1Amb, layer2Amb)
  await printBalances(layer1Wallet, layer2Wallet, layer1Usdc, layer2Usdc)
}

main().then(() => process.exit(0))
