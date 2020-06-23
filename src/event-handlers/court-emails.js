const TimeAgo = require('javascript-time-ago')
TimeAgo.addLocale(require('javascript-time-ago/locale/en'))

const _web3 = require('../utils/web3')
const _sendgrid = require('../utils/sendgrid')
const _klerosLiquid = require('../assets/contracts/KlerosLiquid.json')
const dynamoDB = require('../utils/dynamo-db')
const getEnvVars = require('../utils/get-env-vars')
const webpush = require('web-push')

const timeAgo = new TimeAgo('en-US')
const handlers = {
  Draw: async (_, klerosLiquid, event) => {
      const dispute = await klerosLiquid.methods
        .disputes(event._disputeID)
        .call()
      return [
        {
          account: event._address,
          type: 'Draw',
          disputeID: event._disputeID,
          templateId: 'd-b4880ab92d004827929ad074a714a7cb',
          dynamic_template_data: {
            startDate: (
              event._appeal === '0'
                ? `in ${timeAgo.format(
                    (Number(dispute.lastPeriodChange) +
                      Number(
                        (await klerosLiquid.methods
                          .getSubcourt(dispute.subcourtID)
                          .call()).timesPerPeriod[0]
                      )) *
                      1000
                  )}`
                : 'as soon as all other jurors are drawn'
            ),
            caseNumber: event._disputeID
          },
          pushNotificationText: `You have been drawn in case #${event._disputeID}`
        }
      ]
  },
  Vote: async (_, klerosLiquid, event) => {
    const dispute = await klerosLiquid.methods
      .disputes(event._disputeID)
      .call()
    return [
      {
        account: event._address,
        type: 'Draw', // Use the same setting for Draw and Vote reminders
        disputeID: event._disputeID,
        templateId: 'd-c3bfae61a6cc42c1ab744a10dad0eca7',
        dynamic_template_data: {
          endTime: (
            `in ${timeAgo.format(
                  (Number(dispute.lastPeriodChange) +
                    Number(
                      (await klerosLiquid.methods
                        .getSubcourt(dispute.subcourtID)
                        .call()).timesPerPeriod[2]
                    )) *
                    1000
                )}`
          ),
          caseNumber: event._disputeID
        },
        pushNotificationText: `It is time to vote in case #${event._disputeID}`
      }
    ]
  },
  VoteReminder: async (_, klerosLiquid, event) => {
    const dispute = await klerosLiquid.methods
      .disputes(event._disputeID)
      .call()
    return [
      {
        account: event._address,
        type: 'Draw', // Use the same setting for Draw and Vote reminders
        disputeID: event._disputeID,
        templateId: 'd-56da601bf4334c7c8fa2bd4c65777dca',
        dynamic_template_data: {
          endTime: (
            `in ${timeAgo.format(
                  (Number(dispute.lastPeriodChange) +
                    Number(
                      (await klerosLiquid.methods
                        .getSubcourt(dispute.subcourtID)
                        .call()).timesPerPeriod[2]
                    )) *
                    1000
                )}`
          ),
          caseNumber: event._disputeID
        },
        pushNotificationText: `You have 24 hours left to vote in case #${event._disputeID}`
      }
    ]
  },

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
  const { PRIVATE_KEY } = await getEnvVars(['PRIVATE_KEY'])
  const lambdaAccount = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY.replace(/^\s+|\s+$/g, ''))

  const notifications  = await handlers[event.event](
    web3,
    new web3.eth.Contract(_klerosLiquid.abi, process.env.KLEROS_LIQUID_ADDRESS_MAINNET),
    event
  )

  for (const notification of notifications) {
    const signedUnsubscribeKey = lambdaAccount.sign(notification.account)

    try {
      const settingKey = `courtNotificationSetting${notification.type}`
      const item = await dynamoDB.getItem({
        Key: { address: { S: notification.account } },
        TableName: 'user-settings',
        AttributesToGet: ['email', settingKey, 'pushNotifications', 'pushNotificationsData']
      })

      let email
      let setting
      if (item && item.Item && item.Item.email && item.Item[settingKey]) {
        email = item.Item.email.S
        setting = item.Item[settingKey].BOOL
      }

      if (email && setting) {
        await sendgrid.send({
          to: email,
          from: {
            name: 'Kleros',
            email: 'noreply@kleros.io'
          },
          templateId: notification.templateId,
          dynamic_template_data: {
            ...notification.dynamic_template_data,
            unsubscribe: ` https://hgyxlve79a.execute-api.us-east-2.amazonaws.com/production/unsubscribe?signature=${signedUnsubscribeKey.signature}&account=${notification.account}&dapp=court`
          }
        })
      }

      const pushNotifications = item.Item["pushNotifications"] && item.Item["pushNotifications"].BOOL
      const pushNotificationsData = item.Item["pushNotificationsData"] ? JSON.parse(item.Item["pushNotificationsData"].S) : false

      if (pushNotifications) {
        const { VAPID_KEY } = await getEnvVars(['VAPID_KEY'])
        const options = {
          vapidDetails: {
            subject: 'mailto:contact@kleros.io',
            publicKey: process.env.VAPID_PUB,
            privateKey: VAPID_KEY
          },
          TTL: 60
        }

        await webpush.sendNotification(pushNotificationsData, notification.pushNotificationText, options)
      }
    } catch (_) {}
  }

  callback(null, {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' }
  })
}
