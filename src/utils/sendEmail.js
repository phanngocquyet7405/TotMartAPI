require("dotenv").config();

const { BrevoClient } = require("@getbrevo/brevo");
const logger = require("./logger");

const brevo = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY,
  timeoutInSeconds: 60,
});
const sendEmailWithBrevo = async (toEmail, subject, htmlContent) => {
  try {
    const data = await brevo.transactionalEmails.sendTransacEmail({
      subject: subject,
      htmlContent: htmlContent,
      sender: { name: "TotMart", email: process.env.FROM_EMAIL },
      to: [{ email: toEmail }],
    });
    return { success: true, messageId: data.messageId };
  } catch (error) {
    logger.error({ err: error, toEmail }, "Error sending email");
    return { success: false, error: error.message };
  }
};

module.exports = sendEmailWithBrevo;
