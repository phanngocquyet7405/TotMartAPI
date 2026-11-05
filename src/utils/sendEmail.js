const config = require('../config/environment');

const { BrevoClient } = require('@getbrevo/brevo');
const logger = require('./logger');

const brevo = new BrevoClient({
  apiKey: config.email.apiKey,
  timeoutInSeconds: 60,
});
const sendEmailWithBrevo = async (toEmail, subject, htmlContent) => {
  try {
    const data = await brevo.transactionalEmails.sendTransacEmail({
      subject: subject,
      htmlContent: htmlContent,
      sender: { name: 'TotMart', email: config.email.from },
      to: [{ email: toEmail }],
    });
    return { success: true, messageId: data.messageId };
  } catch (error) {
    // Provider error objects can contain recipient, API key or reset URL.
    logger.error({ dependency: 'email', event: 'delivery_failed' }, 'Email delivery failed');
    return { success: false };
  }
};

module.exports = sendEmailWithBrevo;
