const sgMail = require('@sendgrid/mail')

const getEnvVars = require('./get-env-vars')

module.exports = async () => {
  const { SENDGRID_API_KEY } = await getEnvVars(['SENDGRID_API_KEY'])
  sgMail.setApiKey(SENDGRID_API_KEY)
  sgMail.setSubstitutionWrappers('{{', '}}')

  return sgMail
}
