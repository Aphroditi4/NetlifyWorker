const { BOT_TOKEN, CHAT_ID } = require('./constants');
const storage = require('../db/storage');
const fetch = require('node-fetch');

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
  const messageData = { id: messageId, text: message, timestamp: Date.now(), attempts: 0 };

  const params = new URLSearchParams({
    chat_id: CHAT_ID,
    text: message
  });

  try {
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      console.error('Telegram API error:', await response.text());
      await storage.setTelegramMessage(messageId, { ...messageData, attempts: 1 });
      return false;
    }
    
    console.log('Telegram message sent successfully:', message);
    await storage.deleteTelegramMessage(messageId);
    return true;
  } catch (error) {
    console.error('Error sending to Telegram:', error);
    await storage.setTelegramMessage(messageId, { ...messageData, attempts: 1 });
    return false;
  }
}

async function retryCachedTelegramMessages() {
  const messages = await storage.getTelegramMessages();
  
  for (const [messageId, messageData] of Object.entries(messages)) {
    if (messageData.attempts >= 3) {
      await storage.deleteTelegramMessage(messageId);
      console.log(`Removed message ${messageId} after max attempts`);
      continue;
    }

    const params = new URLSearchParams({
      chat_id: CHAT_ID,
      text: messageData.text
    });

    try {
      const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (response.ok) {
        await storage.deleteTelegramMessage(messageId);
        console.log(`Successfully sent cached message ${messageId}`);
      } else {
        await storage.setTelegramMessage(messageId, {
          ...messageData,
          attempts: messageData.attempts + 1
        });
      }
    } catch (error) {
      await storage.setTelegramMessage(messageId, {
        ...messageData,
        attempts: messageData.attempts + 1
      });
      console.log(`Error retrying message ${messageId}:`, error);
    }
  }
}

module.exports = {
  sendToTelegram,
  retryCachedTelegramMessages
};