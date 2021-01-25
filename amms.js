const fetch = require("cross-fetch")
const { Contract, providers } = require("ethers")
const AmmReaderArtifact = require("@perp/contract/build/contracts/AmmReader.json")
const InsuranceFundArtifact = require("@perp/contract/build/contracts/InsuranceFund.json")

async function setupEnv() {
  const metadataUrl = "https://metadata.perp.exchange/production.json"
  const metadata = await fetch(metadataUrl).then(res => res.json())
  const xDaiUrl = "https://rpc.xdaichain.com/"
  const layer2Provider = new providers.JsonRpcProvider(xDaiUrl)
  const insuranceFundAddr = metadata.layers.layer2.contracts.InsuranceFund.address
  const ammReaderAddr = metadata.layers.layer2.contracts.AmmReader.address

  const insuranceFund = new Contract(insuranceFundAddr, InsuranceFundArtifact.abi, layer2Provider)
  const ammReader = new Contract(ammReaderAddr, AmmReaderArtifact.abi, layer2Provider)
  return {
    insuranceFund, ammReader
  }
}

function getAmmInfo(ammProps) {
  return {
    quoteAssetSymbol: ammProps.quoteAssetSymbol,
    baseAssetSymbol: ammProps.baseAssetSymbol
  }
}

async function main() {
  const { insuranceFund, ammReader } = await setupEnv()
  const ammAddresses = await insuranceFund.getAllAmms()
  const ammProps = await Promise.all(ammAddresses.map(addr => ammReader.getAmmStates(addr)))
  
  const ammInfos = ammProps.map(prop => getAmmInfo(prop))
  console.log(ammInfos)
}

main()
