const qs = require('querystring');

const TimeAgo = require('javascript-time-ago');
TimeAgo.addLocale(require('javascript-time-ago/locale/en'));

const _web3 = require('../utils/web3');
const _sendgrid = require('../utils/sendgrid');
const _klerosLiquid = require('../assets/contracts/KlerosLiquid.json');
const _xKlerosLiquid = require('../assets/contracts/xKlerosLiquid.json');
const dynamoDB = require('../utils/dynamo-db');
const getEnvVars = require('../utils/get-env-vars');
const webpush = require('web-push');

const timeAgo = new TimeAgo('en-US');
const createEventHandlers = (chainId) => ({
  Draw: async (_, klerosLiquid, event) => {
    const dispute = await klerosLiquid.methods
      .disputes(event._disputeID)
      .call();
    return [
      {
        account: event._address,
        type: 'Draw',
        disputeID: event._disputeID,
        templateId: 'd-b4880ab92d004827929ad074a714a7cb',
        dynamic_template_data: {
          startDate:
            event._appeal === '0'
              ? `${timeAgo.format(
                  (Number(dispute.lastPeriodChange) +
                    Number(
                      (
                        await klerosLiquid.methods
                          .getSubcourt(dispute.subcourtID)
                          .call()
                      ).timesPerPeriod[0]
                    )) *
                    1000
                )}`
              : 'as soon as all other jurors are drawn',
          caseNumber: event._disputeID,
          caseUrl: `https://court.kleros.io/cases/${
            event._disputeID
          }?${qs.stringify({ requiredChainId: chainId })}`,
        },
        pushNotificationText: `You have been drawn in case #${event._disputeID}`,
      },
    ];
  },
  Vote: async (_, klerosLiquid, event) => {
    const dispute = await klerosLiquid.methods
      .disputes(event._disputeID)
      .call();
    return [
      {
        account: event._address,
        type: 'Draw', // Use the same setting for Draw and Vote reminders
        disputeID: event._disputeID,
        templateId: 'd-c3bfae61a6cc42c1ab744a10dad0eca7',
        dynamic_template_data: {
          endTime: `${timeAgo.format(
            (Number(dispute.lastPeriodChange) +
              Number(
                (
                  await klerosLiquid.methods
                    .getSubcourt(dispute.subcourtID)
                    .call()
                ).timesPerPeriod[2]
              )) *
              1000
          )}`,
          caseNumber: event._disputeID,
          caseUrl: `https://court.kleros.io/cases/${
            event._disputeID
          }?${qs.stringify({ requiredChainId: chainId })}`,
        },
        pushNotificationText: `It is time to vote in case #${event._disputeID}`,
      },
    ];
  },
  VoteReminder: async (_, klerosLiquid, event) => {
    const dispute = await klerosLiquid.methods
      .disputes(event._disputeID)
      .call();
    return [
      {
        account: event._address,
        type: 'Draw', // Use the same setting for Draw and Vote reminders
        disputeID: event._disputeID,
        templateId: 'd-56da601bf4334c7c8fa2bd4c65777dca',
        dynamic_template_data: {
          endTime: `${timeAgo.format(
            (Number(dispute.lastPeriodChange) +
              Number(
                (
                  await klerosLiquid.methods
                    .getSubcourt(dispute.subcourtID)
                    .call()
                ).timesPerPeriod[2]
              )) *
              1000
          )}`,
          caseNumber: event._disputeID,
          caseUrl: `https://court.kleros.io/cases/${
            event._disputeID
          }?${qs.stringify({ requiredChainId: chainId })}`,
        },
        pushNotificationText: `You have 24 hours left to vote in case #${event._disputeID}`,
      },
    ];
  },
  Appeal: async (_, klerosLiquid, event) => {
    return [
      {
        account: event._address,
        type: 'Appeal', // Use the same setting for Draw and Vote reminders
        disputeID: event._disputeID,
        templateId: 'd-2f9e67361add441b9a85b2116ba90e53',
        dynamic_template_data: {
          caseNumber: event._disputeID,
          caseUrl: `https://court.kleros.io/cases/${
            event._disputeID
          }?${qs.stringify({ requiredChainId: chainId })}`,
        },
        pushNotificationText: `Case #${event._disputeID} has been appealed`,
      },
    ];
  },
  Won: async (_, klerosLiquid, event) => {
    return [
      {
        account: event._address,
        type: 'Win', // Use the same setting for Draw and Vote reminders
        disputeID: event._disputeID,
        templateId: 'd-b6ac074fb68541b09e1463aa66e6aadb',
        dynamic_template_data: {
          ethWon: event._ethWon,
          pnkWon: event._pnkWon,
          caseTitle: event._caseTitle,
          caseNumber: event._disputeID,
          caseUrl: `https://court.kleros.io/cases/${
            event._disputeID
          }?${qs.stringify({ requiredChainId: chainId })}`,
        },
        pushNotificationText: `Horray! You won ${event._ethWon} ETH from case #${event._disputeID}`,
      },
    ];
  },
  Lost: async (_, klerosLiquid, event) => {
    return [
      {
        account: event._address,
        type: 'Lose', // Use the same setting for Draw and Vote reminders
        disputeID: event._disputeID,
        templateId: 'd-588ac6aef7184cad9f3c460dbef5433b',
        dynamic_template_data: {
          pnkLost: event._pnkLost,
          caseTitle: event._caseTitle,
          caseNumber: event._disputeID,
          caseUrl: `https://court.kleros.io/cases/${
            event._disputeID
          }?${qs.stringify({ requiredChainId: chainId })}`,
        },
        pushNotificationText: `You lost ${event._pnkLost} PNK from case #${event._disputeID}`,
      },
    ];
  },
  StakeChanged: async (_, klerosLiquid, event) => {
    return [
      {
        account: event._address,
        type: 'Stake',
        templateId: 'd-231457425dfe444e99ff9f27db599f9c',
        dynamic_template_data: {
          stakesChanged: event._stakesChanged,
        },
        pushNotificationText: `Your court stakes have been updated`,
      },
    ];
  },
});

const createLambdaHandler = (createWeb3, createContract) => {
  return async (_event, _context, callback) => {
    const event = JSON.parse(_event.body);
    if (event === undefined || event === null) {
      return callback(null, {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'No event log passed in body.',
        }),
      });
    }

    const web3 = await _web3();
    const chainId = await web3.eth.getChainId();
    const sendgrid = await _sendgrid();
    const { PRIVATE_KEY } = await getEnvVars(['PRIVATE_KEY']);
    const lambdaAccount = web3.eth.accounts.privateKeyToAccount(
      PRIVATE_KEY.replace(/^\s+|\s+$/g, '')
    );

    const handlers = createEventHandlers(chainId);
    const notifications = await handlers[event.event](
      web3,
      createContract(web3),
      event
    );

    for (const notification of notifications) {
      const signedUnsubscribeKey = lambdaAccount.sign(notification.account);

      try {
        const settingKey = `courtNotificationSetting${notification.type}`;
        const item = await dynamoDB.getItem({
          Key: { address: { S: notification.account } },
          TableName: 'user-settings',
          AttributesToGet: [
            'email',
            settingKey,
            'pushNotifications',
            'pushNotificationsData',
          ],
        });

        let email;
        let setting;
        if (item && item.Item && item.Item.email && item.Item[settingKey]) {
          email = item.Item.email.S;
          setting = item.Item[settingKey].BOOL;
        }

        if (email && setting) {
          console.log('SENDING EMAIL TO ' + email);
          await sendgrid.send({
            to: email,
            from: {
              name: 'Kleros',
              email: 'noreply@kleros.io',
            },
            templateId: notification.templateId,
            dynamic_template_data: {
              ...notification.dynamic_template_data,
              unsubscribe: ` https://hgyxlve79a.execute-api.us-east-2.amazonaws.com/production/unsubscribe?signature=${signedUnsubscribeKey.signature}&account=${notification.account}&dapp=court`,
            },
          });
        }

        const pushNotifications =
          item.Item['pushNotifications'] && item.Item['pushNotifications'].BOOL;
        const pushNotificationsData = item.Item['pushNotificationsData']
          ? JSON.parse(item.Item['pushNotificationsData'].S)
          : false;

        if (pushNotifications) {
          const { VAPID_KEY } = await getEnvVars(['VAPID_KEY']);
          const options = {
            vapidDetails: {
              subject: 'mailto:contact@kleros.io',
              publicKey: process.env.VAPID_PUB,
              privateKey: VAPID_KEY,
            },
            TTL: 60,
          };

          await webpush.sendNotification(
            pushNotificationsData,
            notification.pushNotificationText,
            options
          );
        }
      } catch (_) {}
    }

    callback(null, {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  };
};

module.exports.post = createLambdaHandler(
  _web3,
  (web3) =>
    new web3.eth.Contract(
      _klerosLiquid.abi,
      process.env.KLEROS_LIQUID_ADDRESS_MAINNET
    )
);

module.exports.postXDai = createLambdaHandler(
  _web3.xdaiChain,
  (web3) =>
    new web3.eth.Contract(
      _xKlerosLiquid.abi,
      process.env.X_KLEROS_LIQUID_ADDRESS_XDAI
    )
);
