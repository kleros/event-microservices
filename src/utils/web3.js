const Web3 = require('web3')

module.exports = async () => {
  const INFURA_URL = process.env.INFURA_URL
  return new Web3(new Web3.providers.HttpProvider(INFURA_URL))
}

module.exports.xdaiChain = async () => {
  const XDAI_RPC_URL = process.env.XDAI_RPC_URL
  return new Web3(new Web3.providers.HttpProvider(RPC_URL))
}
