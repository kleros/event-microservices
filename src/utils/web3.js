const Web3 = require('web3')

module.exports = async () => {
  const INFURA_URL = process.env['INFURA_URL']
  return new Web3(new Web3.providers.HttpProvider(INFURA_URL))
}
