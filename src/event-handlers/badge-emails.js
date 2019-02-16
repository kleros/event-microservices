const _web3 = require('../utils/web3')
const _sendgrid = require('../utils/sendgrid')
const _badgeTCR = require('../assets/contracts/ArbitrableAddressList.json')
const dynamoDB = require('../utils/dynamo-db')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const REQUESTER = 1
const handlers = {
  Dispute: async (badgeTCR, event) => {
    const tokenAddress = await badgeTCR.methods
      .disputeIDToAddress(event.returnValues._disputeID)
      .call()

    const addressData = await badgeTCR.methods
      .getAddressInfo(tokenAddress)
      .call()
    const request = await badgeTCR.methods.getRequestInfo(tokenAddress).call()

    return [
      {
        account: request.parties[REQUESTER],
        message: `Your request to ${
          addressData.status === '1' ? 'add' : 'remove'
        } the Ethfinex badge ${
          addressData.status === '1' ? 'to' : 'from'
        } token of address ${tokenAddress} was challenged and awaits arbitration.`,
        to: `/badge/${process.env.BADGE_ADDRESS}/${tokenAddress}`,
        type: 'Dispute'
      }
    ]
  },
  WaitingOponent: async (badgeTCR, event) => {
    const addressData = await badgeTCR.methods
      .getAddressInfo(event._address)
      .call()
    return [
      {
        account: event._party,
        message: `The oponent funded his side of an appeal for the dispute on the ${
          addressData.status === '1' ? 'addition' : 'removal'
        } of the Ethfinex badge to the token of address ${
          event._address
        }. You must fund your side of the appeal to not lose the case.`,
        to: `/badge/${process.env.BADGE_ADDRESS}/${event._address}`,
        type: 'ShouldFund'
      }
    ]
  },
  NewPeriod: async (badgeTCR, event) => {
    const APPEAL_PERIOD = '3'
    if (event._period !== APPEAL_PERIOD) return // Not appeal period.

    const tokenAddress = await badgeTCR.methods
      .disputeIDToAddress(event._disputeID)
      .call()
    if (tokenAddress === ZERO_ADDRESS) return // Dispute is not related to Badge TCR.

    const addressData = await badgeTCR.methods
      .getAddressInfo(tokenAddress)
      .call()
    const request = await badgeTCR.methods
      .getRequestInfo(tokenAddress, addressData.numberOfRequests - 1)
      .call()
    return request.parties
      .map(party => ({
        account: party,
        message: `The arbitrator gave a ruling on the dispute over the request to ${
          addressData.status === '1' ? 'add' : 'remove'
        } the Ethfinex badge ${
          addressData.status === '1' ? 'to' : 'from'
        } the token of address ${tokenAddress}. The request entered the appeal period. Raise an appeal before the end of the appeal period if you think the ruling is incorrect.`,
        to: `/badge/${process.env.BADGE_ADDRESS}/${tokenAddress}`,
        type: 'RulingGiven'
      }))
      .filter(n => n.account !== ZERO_ADDRESS) // Parties array has 3 elements, the first of which is unused.
  }
}

module.exports.post = async (_event, _context, callback) => {
  const event = JSON.parse(_event.body)
  if (event === undefined || event === null) {
    return callback(null, {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: 'No event log passed in body.'
      })
    })
  }

  const web3 = await _web3()
  const sendgrid = await _sendgrid()
  for (const notification of handlers[event.event](
    new web3.eth.Contract(_badgeTCR.abi, process.env.BADGE_ADDRESS),
    event
  )) {
    try {
      const settingKey = `t2crNotificationSetting${notification.type}`
      const item = await dynamoDB.getItem({
        Key: { address: { S: notification.account } },
        TableName: 'user-settings',
        AttributesToGet: ['email', settingKey]
      })

      let email
      let setting
      if (item && item.Item && item.Item.email && item.Item[settingKey]) {
        email = item.Item.email.S
        setting = item.Item[settingKey].BOOL
      }
      if (!email || !setting) continue

      await sendgrid.send({
        to: email,
        from: {
          name: 'Kleros',
          email: 'noreply@kleros.io'
        },
        templateId: 'd-8132eed4934e4840befa3a0ec22a9520',
        dynamic_template_data: {
          message: notification.message,
          to: notification.to
        }
      })
    } catch (_) {}
  }

  callback(null, {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' }
  })
}
