const centralizedArbitrator = require('@kleros/kleros-interaction/build/contracts/CentralizedArbitrator.json')

const _web3 = require('../utils/web3')
const _sendgrid = require('../utils/sendgrid')
const dynamoDB = require('../utils/dynamo-db')

module.exports.post = async (
  centralizedArbitratorAddress,
  event,
  _context,
  callback
) => {
  // Get the event body
  const body = JSON.parse(event.body)
  if (body == null) {
    return callback(null, {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: 'No event log passed in body.'
      })
    })
  }

  const centralizedArbitratorInstance = new _web3.eth.Contract(
    centralizedArbitrator.abi,
    centralizedArbitratorAddress,
    {
      gasPrice: 20000000000
    }
  )

  const owner = centralizedArbitratorInstance.methods.owner().call()

  // Fetch from the user-settings table
  const item = await dynamoDB.getItem({
    Key: { address: { S: owner } },
    TableName: 'user-settings',
    AttributesToGet: ['email']
  })

  const item2 = await dynamoDB.getItem({
    Key: { address: { S: owner } },
    TableName: 'user-settings',
    AttributesToGet: [
      'centralizedArbitratorDashboardNotificationSettingDisputes'
    ]
  })

  const item3 = await dynamoDB.getItem({
    Key: { address: { S: owner } },
    TableName: 'user-settings',
    AttributesToGet: ['fullName']
  })

  let emailAddress
  if (item && item.Item && item.Item.email) emailAddress = item.Item.email.S

  let wantsEmailForDisputes
  if (
    item2 &&
    item2.Item &&
    item2.Item.centralizedArbitratorDashboardNotificationSettingDisputes
  ) {
    wantsEmailForDisputes =
      item2.Item.centralizedArbitratorDashboardNotificationSettingDisputes.S
  }

  if (!wantsEmailForDisputes)
    return callback(null, {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        sent: false,
        reason: "User doesn't want to receive emails for new disputes."
      })
    })

  let fullName
  if (item3 && item3.Item && item3.Item.fullName)
    fullName = item3.Item.fullName.S

  if (emailAddress == null)
    return callback(null, {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        sent: false,
        reason: 'No email address found.'
      })
    })

  const networkName = await _web3.eth.net.getNetworkType()

  // TODO Add your email template and message here
  const msg = {
    to: emailAddress,
    from: {
      name: 'Kleros',
      email: 'contact@kleros.io'
    },
    templateId: 'd-8e6dd684d23447a8a5051adf69396d58',
    dynamic_template_data: {
      name: fullName,
      arbitratorAddress: centralizedArbitratorAddress,
      disputeID: body._disputeID,
      networkName: networkName,
      subject: 'You Have A New Dispute Awaiting Your Arbitration',
      eventName: body.event
    }
  }

  // Sendgrid
  const sendGridClient = await _sendgrid()
  let sent = true
  let reason
  try {
    await sendGridClient.send(msg)
  } catch (err) {
    sent = false
    reason = err
  }

  callback(null, {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      sent,
      reason
    })
  })
}
