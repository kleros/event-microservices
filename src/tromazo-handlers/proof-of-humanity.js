const { GraphQLClient, gql } = require('graphql-request')

const _proofOfHumanity = require('../assets/contracts/ProofOfHumanity.json')
const _sendgrid = require('../utils/sendgrid')
const _web3 = require('../utils/web3')
const dynamoDB = require('../utils/dynamo-db')
const getEnvVars = require('../utils/get-env-vars')

const getAccountsForSubmission = async (
  graph,
  submissionID,
  numberOfRequests = 1
) => {
  const {
    submission: { requests },
    submissions
  } = await graph.request(
    gql`
      query getAccountsForSubmissionQuery(
        $id: ID!
        $numberOfRequests: Int!
        $ids: [ID!]!
      ) {
        submission(id: $id) {
          requests(
            orderBy: creationTime
            orderDirection: desc
            first: $numberOfRequests
          ) {
            requester
            challenges {
              challenger
              rounds {
                contributions {
                  contributor
                }
              }
            }
          }
        }
        submissions(where: { vouchees_contains: $ids, usedVouch: null }) {
          id
        }
      }
    `,
    {
      id: submissionID,
      numberOfRequests,
      ids: [submissionID]
    }
  )
  return [
    submissionID,
    ...requests.flatMap(({ requester, challenges }) => [
      requester,
      ...challenges.flatMap(({ challenger, rounds }) => [
        challenger,
        ...rounds.flatMap(({ contributions }) =>
          contributions.map(({ contributor }) => contributor)
        )
      ])
    ]),
    ...submissions.map(({ id }) => id)
  ]
}
const handlers = {
  SubmissionChallenged: async (_web3, graph, _proofOfHumanity, event) => {
    const accounts = await getAccountsForSubmission(
      graph,
      event.returnValues._submissionID
    )
    return accounts.map(account => ({
      account: account,
      templateId: 'd-2cdd60c3ddc24c0f90e849d0185b83bc',
      dynamic_template_data: {
        submissionid: event.returnValues._submissionID
      }
    }))
  },
  HasPaidAppealFee: async (_web3, graph, _proofOfHumanity, event) => {
    const accounts = await getAccountsForSubmission(
      graph,
      event.returnValues._submissionID
    )
    return accounts.map(account => ({
      account: account,
      templateId: 'd-c881eb7d645f4178b40f7c622900fef3',
      dynamic_template_data: {
        submissionid: event.returnValues._submissionID
      }
    }))
  },
  ChallengeResolved: async (_web3, graph, _proofOfHumanity, event) => {
    const accounts = await getAccountsForSubmission(
      graph,
      event.returnValues._submissionID
    )
    return accounts.map(account => ({
      account: account,
      templateId: 'd-00a956cad92544e79b65385439dcaa88',
      dynamic_template_data: {
        submissionid: event.returnValues._submissionID
      }
    }))
  },
  SubmissionReapplied: async (_web3, graph, _proofOfHumanity, event) => {
    const accounts = await getAccountsForSubmission(
      graph,
      event.returnValues._submissionID
    )
    return accounts.map(account => ({
      account: account,
      templateId: 'd-ab5bf7ddaad44f2c819bf01363a282cb',
      dynamic_template_data: {
        submissionid: event.returnValues._submissionID
      }
    }))
  }
}
module.exports.post = async (_event, _context, callback) => {
  const events = JSON.parse(_event.body)
  if (events === undefined || events === null) {
    return callback(null, {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: 'No event logs passed in body.'
      })
    })
  }

  const web3 = await _web3()
  const lambdaAccount = web3.eth.accounts.privateKeyToAccount(
    (await getEnvVars(['PRIVATE_KEY'])).PRIVATE_KEY.replace(/^\s+|\s+$/g, '')
  )
  const sendgrid = await _sendgrid()

  for (const event of events) {
    const notifications = await handlers[event.event](
      web3,
      new GraphQLClient(process.env.PROOF_OF_HUMANITY_SUBGRAPH_URL),
      new web3.eth.Contract(
        _proofOfHumanity.abi,
        process.env.PROOF_OF_HUMANITY_CONTRACT_ADDRESS
      ),
      event
    )
    for (const notification of notifications) {
      try {
        const item = await dynamoDB.getItem({
          Key: { address: { S: notification.account } },
          TableName: 'user-settings',
          AttributesToGet: ['email', 'proofOfHumanityNotifications']
        })

        let email
        let setting
        if (
          item &&
          item.Item &&
          item.Item.email &&
          item.Item.proofOfHumanityNotifications
        ) {
          email = item.Item.email.S
          setting = item.Item.proofOfHumanityNotifications.BOOL
        }

        if (email && setting) {
          console.log('SENDING EMAIL TO ' + email)
          await sendgrid.send({
            to: email,
            from: {
              name: 'Kleros',
              email: 'noreply@kleros.io'
            },
            templateId: notification.templateId,
            dynamic_template_data: {
              ...notification.dynamicTemplateData,
              unsubscribe: ` https://hgyxlve79a.execute-api.us-east-2.amazonaws.com/production/unsubscribe?signature=${
                lambdaAccount.sign(notification.account).signature
              }&account=${notification.account}&dapp=proofOfHumanity`
            }
          })
        }
      } catch (_) {}
    }
  }

  callback(null, {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' }
  })
}
