const { BOT_TOKEN, CHAT_ID } = require('./constants');
const fetch = require('node-fetch');
const storage = require('../db/storage');

async function sendToTelegram(phoneNumber, terminal = 'Unknown', amount = 'Unknown', orderNumber = 'Unknown') {
  const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const message = `
  🌟 **Transaction Details** 🌟

  📞 Phone: ${phoneNumber || 'Not Provided'}

  🏪 Terminal: ${terminal}

  💶 Amount: ${amount}€

  🧾 Order: ${orderNumber}
  `.trim();

  const messageId = `${orderNumber}-${Date.now()}`;
  const messageData = { text: message, timestamp: Date.now(), attempts: 0 };

  const params = new URLSearchParams({
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });

  try {
    console.log('Sending telegram message:', message);
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      console.error('Telegram API error:', await response.text());
      await storage.storeTelegramMessage(messageId, { ...messageData, attempts: 1 });
      return false;
    }
    
    console.log('Telegram message sent successfully');
    return true;
  } catch (error) {
    console.error('Error sending to Telegram:', error);
    await storage.storeTelegramMessage(messageId, { ...messageData, attempts: 1 });
    return false;
  }
}

async function retryCachedTelegramMessages() {
  const pendingMessages = await storage.getPendingTelegramMessages();
  const results = { success: 0, failure: 0, removed: 0 };

  for (const message of pendingMessages) {
    const messageId = message.messageId;
    
    // Пропускаем сообщения, которые уже пытались отправить слишком много раз
    if (message.attempts >= 3) {
      await storage.deleteTelegramMessage(messageId);
      console.log(`Removed message ${messageId} after max attempts`);
      results.removed++;
      continue;
    }

    const params = new URLSearchParams({
      chat_id: CHAT_ID,
      text: message.text,
      parse_mode: 'Markdown'
    });

    try {
      console.log(`Retrying telegram message: ${messageId}`);
      const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (response.ok) {
        await storage.deleteTelegramMessage(messageId);
        console.log(`Successfully sent cached message ${messageId}`);
        results.success++;
      } else {
        await storage.updateTelegramMessage(messageId, {
          attempts: message.attempts + 1
        });
        console.log(`Failed to retry message ${messageId}, attempt ${message.attempts + 1}`);
        results.failure++;
      }
    } catch (error) {
      await storage.updateTelegramMessage(messageId, {
        attempts: message.attempts + 1
      });
      console.log(`Error retrying message ${messageId}:`, error);
      results.failure++;
    }
  }

  return results;
}

module.exports = {
  sendToTelegram,
  retryCachedTelegramMessages
};