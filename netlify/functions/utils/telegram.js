const { BOT_TOKEN, CHAT_ID } = require('./constants');
const fetch = require('node-fetch');

// Спрощене тимчасове зберігання
const pendingMessages = {};

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
      pendingMessages[messageId] = { ...messageData, attempts: 1 };
      return false;
    }
    
    console.log('Telegram message sent successfully');
    delete pendingMessages[messageId];
    return true;
  } catch (error) {
    console.error('Error sending to Telegram:', error);
    pendingMessages[messageId] = { ...messageData, attempts: 1 };
    return false;
  }
}

async function retryCachedTelegramMessages() {
  for (const [messageId, messageData] of Object.entries(pendingMessages)) {
    if (messageData.attempts >= 3) {
      delete pendingMessages[messageId];
      console.log(`Removed message ${messageId} after max attempts`);
      continue;
    }

    const params = new URLSearchParams({
      chat_id: CHAT_ID,
      text: messageData.text,
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
        delete pendingMessages[messageId];
        console.log(`Successfully sent cached message ${messageId}`);
      } else {
        pendingMessages[messageId] = {
          ...messageData,
          attempts: messageData.attempts + 1
        };
        console.log(`Failed to retry message ${messageId}, attempt ${messageData.attempts + 1}`);
      }
    } catch (error) {
      pendingMessages[messageId] = {
        ...messageData,
        attempts: messageData.attempts + 1
      };
      console.log(`Error retrying message ${messageId}:`, error);
    }
  }
}

module.exports = {
  sendToTelegram,
  retryCachedTelegramMessages
};