// Спрощена версія зберігання без використання Netlify Blobs
// Замість цього використовуємо локальні об'єкти (це не постійне зберігання)

// В Netlify Functions кожен виклик функції є окремим, тому ці об'єкти не зберігаються між викликами
// Ця реалізація призначена лише для базової функціональності
const phoneNumbers = {};
const payments = {};
const telegramMessages = {};

class Storage {
  // Методи для роботи з номерами телефонів
  async getPhoneNumber(clientIP) {
    return phoneNumbers[clientIP] || null;
  }

  async setPhoneNumber(clientIP, phoneNumber) {
    try {
      phoneNumbers[clientIP] = phoneNumber;
      console.log('Stored phone number:', phoneNumber, 'for IP:', clientIP);
      return true;
    } catch (error) {
      console.error('Error storing phone number:', error);
      return false;
    }
  }

  // Методи для роботи з платежами
  async getPaymentData(sessionId) {
    return payments[sessionId] || null;
  }

  async setPaymentData(sessionId, paymentData) {
    try {
      payments[sessionId] = paymentData;
      return true;
    } catch (error) {
      console.error('Error storing payment data:', error);
      return false;
    }
  }

  async deletePaymentData(sessionId) {
    try {
      delete payments[sessionId];
      return true;
    } catch (error) {
      console.error('Error deleting payment data:', error);
      return false;
    }
  }

  // Методи для роботи з повідомленнями Telegram
  async getTelegramMessages() {
    return { ...telegramMessages };
  }

  async setTelegramMessage(messageId, messageData) {
    try {
      telegramMessages[messageId] = messageData;
      return true;
    } catch (error) {
      console.error('Error storing telegram message:', error);
      return false;
    }
  }

  async deleteTelegramMessage(messageId) {
    try {
      delete telegramMessages[messageId];
      return true;
    } catch (error) {
      console.error('Error deleting telegram message:', error);
      return false;
    }
  }
}

module.exports = new Storage();