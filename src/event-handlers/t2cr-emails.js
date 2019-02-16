const _web3 = require('../utils/web3')
const _sendgrid = require('../utils/sendgrid')
const _t2cr = require('../assets/contracts/ArbitrableTokenList.json')
const dynamoDB = require('../utils/dynamo-db')

const REQUESTER = 1
const handlers = {
  Dispute: async (t2cr, event) => {
    const tokenID = await t2cr.methods
      .disputeIDToTokenID(event.returnValues._disputeID)
      .call()
    const token = await t2cr.methods.getTokenInfo(tokenID).call()
    const request = await t2cr.methods.getRequestInfo(tokenID).call()

    return [
      {
        account: request.parties[REQUESTER],
        message: `Your request to ${
          token.status === '1' ? 'register' : 'remove'
        } ${token.name} (${
          token.ticker
        }) was challenged and awaits arbitration.`,
        to: `/token/${tokenID}`,
        type: 'Dispute'
      }
    ]
  },
  WaitingOponent: async (t2cr, event) => {
    const token = await t2cr.methods.getTokenInfo(event._tokenID).call()
    return [
      {
        account: event._party,
        message: `The oponent funded his side of an appeal for the dispute on the ${
          token.status === '1' ? 'registration' : 'removal'
        } request for ${token.name} (${
          token.ticker
        }). You must fund your side of the appeal to not lose the case.`,
        to: `/token/${event._tokenID}`,
        type: 'ShouldFund'
      }
    ]
  },
  NewPeriod: async (t2cr, event) => {
    const APPEAL_PERIOD = '3'
    if (event._period !== APPEAL_PERIOD) return // Not appeal period.

    const tokenID = await t2cr.methods
      .disputeIDToTokenID(event._disputeID)
      .call()
    if (
      tokenID ===
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    )
      return // Dispute is not related to T2CR.

    const token = await t2cr.methods.getTokenInfo(tokenID).call()
    const request = await t2cr.methods
      .getRequestInfo(tokenID, token.numberOfRequests - 1)
      .call()
    return request.parties
      .map(party => ({
        account: party,
        message: `The arbitrator gave a ruling on the dispute over the ${
          token.status === '1' ? 'registration' : 'removal'
        } request for ${token.name} (${
          token.ticker
        }). The request entered the appeal period. Raise an appeal before the end of the appeal period if you think the ruling is incorrect.`,
        to: `/token/${tokenID}`,
        type: 'RulingGiven'
      }))
      .filter(n => n.account !== '0x0000000000000000000000000000000000000000') // Parties array has 3 elements, the first of which is unused.
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
    new web3.eth.Contract(_t2cr.abi, process.env.T2CR_ADDRESS),
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
