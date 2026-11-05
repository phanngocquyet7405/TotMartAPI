const mockDelivery = jest.fn();
jest.mock('@getbrevo/brevo', () => ({ BrevoClient: jest.fn().mockImplementation(() => ({ transactionalEmails: { sendTransacEmail: mockDelivery } })) }));
jest.mock('../src/utils/logger', () => ({ error: jest.fn() }));
const sendEmail = require('../src/utils/sendEmail');
const logger = require('../src/utils/logger');

test('provider failure never logs recipient, token URL or provider error object', async () => {
  mockDelivery.mockRejectedValue(Object.assign(new Error('Synthetic provider diagnostic'), {
    request: { headers: { authorization: 'synthetic-only' }, body: { html: 'synthetic-reset-link' } },
  }));
  expect(await sendEmail('synthetic@example.com','Synthetic subject','Synthetic content')).toEqual({success:false});
  expect(logger.error).toHaveBeenCalledWith({dependency:'email',event:'delivery_failed'},'Email delivery failed');
  expect(logger.error.mock.calls[0]).toHaveLength(2);
});
