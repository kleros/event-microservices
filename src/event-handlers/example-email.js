/**
 * Example email sending lambda function that works with events.kleros.io.
 * Replace the email lookup with your subscribers for an event and replace your sendgrid template.
 */
const _web3 = require('../utils/web3')
const _sendgrid = require('../utils/sendgrid')
const dynamoDB = require('../utils/dynamo-db')

module.exports.post = async (event, _context, callback) => {
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

  // TODO determine which email address you want to use. This example uses the caller of tx that kicks off the event
  const txHash = body.transactionHash

  // Find the sender of the tx
  const web3 = await _web3()
  const transaction = await web3.eth.getTransaction(txHash)

  // Fetch from the user-settings table
  const item = await dynamoDB.getItem({
    Key: { address: { S: transaction.from } }, // TODO determine which ETH address to use to lookup email
    TableName: 'user-settings',
    AttributesToGet: ['email']
  })

  let emailAddress
  if (item && item.Item && item.Item.email) emailAddress = item.Item.email.S

  if (emailAddress == null)
    return callback(null, {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        sent: false,
        reason: 'No email address found.'
      })
    })

  // TODO Add your email template and message here
  const msg = {
    to: emailAddress,
    from: {
      name: 'Kleros',
      email: 'contact@kleros.io'
    },
    templateId: 'd-9a9d84fc7ec74b67bce3ee490be67c3b', // TODO replace template ID here
    dynamic_template_data: { // TODO Add your template variables here
      subject: 'Test Email Update',
      eventName: body.event
    }
  }

  // Sendgrid
  sendGridClient = await _sendgrid()
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
