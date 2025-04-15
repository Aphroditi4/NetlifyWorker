const fetch = require('node-fetch');

// Telegram конфигурация
const BOT_TOKEN = '7893480287:AAHxU-22yTVue6Qf8g7CSKgLLGLZizmGXWA';
const CHAT_ID = '-1002370300543';

// Отправка данных о транзакции в Telegram
async function sendToTelegram(phoneNumber, terminal = 'Unknown', amount = 'Unknown', orderNumber = 'Unknown') {
  const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const message = `
  🌟 **Transaction Details** 🌟

  📞 Phone: ${phoneNumber || 'Not Provided'}

  🏪 Terminal: ${terminal}

  💶 Amount: ${amount}€

  🧾 Order: ${orderNumber}
  `.trim();

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
      return false;
    }
    
    console.log('Telegram message sent successfully');
    return true;
  } catch (error) {
    console.error('Error sending to Telegram:', error);
    return false;
  }
}

module.exports = {
  sendToTelegram
};