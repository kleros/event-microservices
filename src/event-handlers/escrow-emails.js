const multipleArbitrableTransaction = require('@kleros/kleros-interaction/build/contracts/MultipleArbitrableTransaction.json')

const _web3 = require('../utils/web3')
const _sendgrid = require('../utils/sendgrid')
const dynamoDB = require('../utils/dynamo-db')

const handlers = {
  HasToPayFee: async (web3, contractInstance, event) => {
    return [
      {
        type: 'Dispute',
        account: event.returnValues._party,
        templateId: 'd-cab9331b7d024dfc9a873944d5ac6de9',
        templateData: {
          subject: '[Escrow] Pay arbitration fee',
          arbitrableTransactionId: event.returnValues._transactionID,
          addressHasToPayFee: event.returnValues._party,
          eventName: event.event
        }
      }
    ]
  },
  Dispute: async (web3, contractInstance, event) => {
    const transactionID = await contractInstance.methods.disputeIDtoTransactionID(
      event.returnValues._disputeID
    ).call()

    const transaction = await contractInstance.methods.transactions(transactionID).call()

    const senderAddress = transaction.sender
    const receiverAddress = transaction.receiver

    return [senderAddress, receiverAddress].map(address => ({
      type: 'Dispute',
      account: address,
      templateId: 'd-dc8c885ab9a8432994db7ba0944869ed',
      templateData: {
        subject: '[Escrow] Dispute In Progress',
        arbitrableTransactionId: transactionID,
        buyer: senderAddress,
        seller: receiverAddress,
        eventName: event.event
      }
    }))
  },
  AppealRuling: async (web3, contractInstance, event) => {
    // dispute is unrelated to escrow
    if (event.returnValues._arbitrable !== process.env.ESCROW_CONTRACT_ADDRESS) return []

    const transactionID = await contractInstance.methods.disputeIDtoTransactionID(
      event.returnValues._disputeID
    ).call()

    const transaction = await contractInstance.methods.transactions(transactionID).call()

    const senderAddress = transaction.sender
    const receiverAddress = transaction.receiver

    return [senderAddress, receiverAddress].map(address => ({
      type: 'Appeal',
      account: address,
      templateId: 'd-7c925b8279fa4a328dab93b9e9a806f1',
      templateData: {
        subject: '[Escrow] Dispute Has Been Appealed',
        arbitrableTransactionId: transactionID,
        buyer: senderAddress,
        seller: receiverAddress,
        eventName: event.event
      }
    }))
  },
  Ruling: async (web3, contractInstance, event) => {
    const transactionID = await contractInstance.methods.disputeIDtoTransactionID(
      event.returnValues._disputeID
    ).call()

    const transaction = await contractInstance.methods.transactions(transactionID).call()

    const senderAddress = transaction.sender
    const receiverAddress = transaction.receiver

    return [senderAddress, receiverAddress].map(address => ({
      type: 'RulingGiven',
      account: address,
      templateId: 'd-c271326346bf484eb45c485ab79f38a0',
      templateData: {
        subject: '[Escrow] Dispute Closed',
        arbitrableTransactionId: transactionID,
        buyer: senderAddress,
        seller: receiverAddress,
        eventName: event.event
      }
    }))
  }
}

module.exports.post = async (_event, _context, callback) => {
  // Get the event body
  const event = JSON.parse(_event.body)
  if (event == null) {
    return callback(null, {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: 'No event log passed in body.'
      })
    })
  }

  const web3 = await _web3()
  const sendGridClient = await _sendgrid()
  for (const notification of await handlers[event.event](
    web3,
    new web3.eth.Contract(multipleArbitrableTransaction.abi, process.env.ESCROW_CONTRACT_ADDRESS),
    event
  )) {
    // Fetch from the user-settings table
    const settingKey = `escrowNotificationSetting${notification.type}`
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

    const msg = {
      to: email,
      from: {
        name: 'Kleros - Escrow',
        email: 'contact@kleros.io'
      },
      templateId: notification.templateId,
      dynamic_template_data: notification.templateData
    }

    await sendGridClient.send(msg)
  }

  callback(null, {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' }
  })
}
