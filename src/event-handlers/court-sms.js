const dynamoDB = require('../utils/dynamo-db')
const sns = require('../utils/sns')
const phone = require('phone')

module.exports.post = async (_event, _context, callback) => {
  const event = JSON.parse(_event.body)

  const item = await dynamoDB.getItem({
    Key: { address: { S: event.account } },
    TableName: 'user-settings',
    AttributesToGet: ['phone']
  })
  console.log(item)

  let phoneNumber
  if (item && item.Item && item.Item.phone)
    phoneNumber = item.Item.phone.S

  // If no number return failed message
  if (!phoneNumber)
    return callback(null, {
      statusCode: 401,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: 'Account missing phone number'
      })
    })

  let addedPlus = false
  if (phoneNumber[0] !== '+') {
    phoneNumber = '+' + phoneNumber
    addedPlus = true
  }

  const e164Phone = phone(phoneNumber)

  try {
    await sns.publish({
      Message: event.message,
      PhoneNumber: phoneNumber
    })

    // update phone number to include +
    if (addedPlus) {
      await dynamoDB.updateItem({
        Key: { address: { S: event.account } },
        TableName: 'user-settings',
        UpdateExpression: `SET phone = :_phone`,
        ExpressionAttributeValues: {
          ":_phone": {
            S: phoneNumber
          }
        }
      })
    }
  } catch (e) {
    console.error(e)
    // Remove phone number from db on fail
    await dynamoDB.updateItem({
      Key: { address: { S: event.account } },
      TableName: 'user-settings',
      UpdateExpression: `SET phone = :_phone`,
      ExpressionAttributeValues: {
        ":_phone": {
          S: ''
        }
      }
    })
  }
}
