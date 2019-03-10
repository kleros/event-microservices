const TimeAgo = require('javascript-time-ago')
TimeAgo.addLocale(require('javascript-time-ago/locale/en'))

const _web3 = require('../utils/web3')
const _sendgrid = require('../utils/sendgrid')
const _klerosLiquid = require('../assets/contracts/KlerosLiquid.json')
const dynamoDB = require('../utils/dynamo-db')

const timeAgo = new TimeAgo('en-US')
const handlers = {
  AppealDecision: async (_, klerosLiquid, event) => {
    const dispute = await klerosLiquid.methods
      .disputes(event.returnValues._disputeID)
      .call()
    if (dispute.period !== '4') {
      const notification = {
        message: `Case #${event.returnValues._disputeID} has been appealed.`,
        to: `/cases/${event.returnValues._disputeID}`,
        type: 'Appeal'
      }
      return (await klerosLiquid.getPastEvents('Draw', {
        filter: { _disputeID: event.returnValues._disputeID },
        fromBlock: 0
      })).map(d => ({
        ...notification,
        account: d.returnValues._address
      }))
    }
    return []
  },
  Draw: async (_, klerosLiquid, event) => {
    const dispute = await klerosLiquid.methods
      .disputes(event.returnValues._disputeID)
      .call()
    if (dispute.period !== '4') {
      const dispute2 = await klerosLiquid.methods
        .getDispute(event.returnValues._disputeID)
        .call()
      if (
        Number(event.returnValues._appeal) ===
        dispute2.votesLengths.length - 1
      )
        return [
          {
            account: event.returnValues._address,
            message: `Congratulations! You have been drawn as a juror on case #${
              event.returnValues._disputeID
            }. Voting starts ${timeAgo.format(
              (Number(dispute.lastPeriodChange) +
                Number(
                  (await klerosLiquid.methods
                    .getSubcourt(dispute.subcourtID)
                    .call()).timesPerPeriod[0]
                )) *
                1000
            )}`,
            to: `/cases/${event.returnValues._disputeID}`,
            type: 'Draw'
          }
        ]
    }
    return []
  },
  TokenAndETHShift: async (web3, _, event) => [
    {
      account: event.returnValues._address,
      message: `Case #${
        event.returnValues._disputeID
      } was executed. ETH: ${Number(
        web3.utils.fromWei(event.returnValues._ETHAmount)
      ).toFixed(4)}, PNK: ${Number(
        web3.utils.fromWei(event.returnValues._tokenAmount)
      ).toFixed(0)}.`,
      to: `/cases/${event.returnValues._disputeID}`,
      type: web3.utils
        .toBN(event.returnValues._ETHAmount)
        .gte(web3.utils.toBN(0))
        ? 'Win'
        : 'Lose'
    }
  ]
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
  for (const notification of await handlers[event.event](
    web3,
    new web3.eth.Contract(_klerosLiquid.abi, process.env.KLEROS_LIQUID_ADDRESS),
    event
  )) {
    try {
      const settingKey = `courtNotificationSetting${notification.type}`
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
