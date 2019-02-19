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
    const request = await t2cr.methods
      .getRequestInfo(tokenID, Number(token.numberOfRequests) - 1)
      .call()

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
  WaitingOpponent: async (t2cr, event) => {
    const token = await t2cr.methods
      .getTokenInfo(event.returnValues._tokenID)
      .call()
    return [
      {
        account: event.returnValues._party,
        message: `The opponent funded his side of an appeal for the dispute on the ${
          token.status === '1' ? 'registration' : 'removal'
        } request for ${token.name} (${
          token.ticker
        }). You must fund your side of the appeal to not lose the case.`,
        to: `/token/${event.returnValues._tokenID}`,
        type: 'ShouldFund'
      }
    ]
  },
  NewPeriod: async (t2cr, event) => {
    const APPEAL_PERIOD = '3'
    if (event.returnValues._period !== APPEAL_PERIOD) return // Not appeal period.

    const tokenID = await t2cr.methods
      .disputeIDToTokenID(event.returnValues._disputeID)
      .call()

    if (
      tokenID ===
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    )
      return // Dispute is not related to T2CR.

    const token = await t2cr.methods.getTokenInfo(tokenID).call()
    const request = await t2cr.methods
      .getRequestInfo(tokenID, Number(token.numberOfRequests) - 1)
      .call()

    return request.parties
      .filter(acc => acc !== '0x0000000000000000000000000000000000000000') // Parties array has 3 elements, the first of which is unused.
      .map(party => ({
        account: party,
        message: `The arbitrator gave a ruling on the dispute on the ${
          token.status === '1' ? 'registration' : 'removal'
        } request for ${token.name} (${
          token.ticker
        }). The request entered the appeal period. Raise an appeal before the end of the appeal period if you think the ruling is incorrect.`,
        to: `/token/${tokenID}`,
        type: 'RulingGiven'
      }))
  }
}

module.exports.post = async (_event, _context, callback) => {
  const event =
    typeof _event.body === 'string' ? JSON.parse(_event.body) : _event.body

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
  for (const notification of await handlers[event.event](
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
      let name
      let setting
      if (item && item.Item && item.Item.email && item.Item[settingKey]) {
        email = item.Item.email.S
        name = item.Item.name.S
        setting = item.Item[settingKey].BOOL
      }
      if (!email || !setting) continue

      await sendgrid.send({
        to: email,
        from: {
          name: 'Kleros',
          email: 'noreply@kleros.io'
        },
        templateId: 'd-d27b8715f86b49cd99fbcc572c43bd8d',
        dynamic_template_data: {
          message: notification.message,
          to: notification.to,
          itemType: 'token',
          name
        }
      })
    } catch (err) {
      console.error(err)
      return callback(null, {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: err
        })
      })
    }
  }

  callback(null, {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' }
  })
}
