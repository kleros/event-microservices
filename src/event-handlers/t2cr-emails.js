const _web3 = require('../utils/web3')
const _sendgrid = require('../utils/sendgrid')
const _t2cr = require('../assets/contracts/ArbitrableTokenList.json')
const dynamoDB = require('../utils/dynamo-db')

const handlers = {
  Dispute: async (t2cr, event) => {
    const tokenID = await t2cr.methods
      .disputeIDToTokenID(event.returnValues._disputeID)
      .call()
    const token = await t2cr.methods.getTokenInfo(tokenID).call()
    const request = await t2cr.methods.getRequestInfo(tokenID).call()

    return [
      {
        account: request.parties[1],
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
        } request for ${token.name} (${token.ticker}). You must fund your side of the appeal to not lose the case.`,
        to: `/token/${event._tokenID}`,
        type: 'Dispute'
      }
    ]
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
