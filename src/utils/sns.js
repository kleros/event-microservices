const { promisify } = require('util')

const { SNS } = require('aws-sdk')

const sns = new SNS({apiVersion: '2010-03-31', region: 'us-east-1'})
sns.publish = promisify(sns.publish)

module.exports = sns
