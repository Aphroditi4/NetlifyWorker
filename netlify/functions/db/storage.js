// Використовуємо Netlify Key-Value Store для постійного зберігання
const { getStore } = require('@netlify/blobs');

// Для Netlify Functions ми не можемо використовувати глобальні змінні як у Cloudflare Workers
// Замість цього використовуємо KV-сховище Netlify
class Storage {
  constructor() {
    this.phoneStore = getStore('phone-numbers');
    this.paymentStore = getStore('payments');
    this.telegramStore = getStore('telegram-messages');
  }

  // Методи для роботи з номерами телефонів
  async getPhoneNumber(clientIP) {
    try {
      return await this.phoneStore.get(clientIP);
    } catch (error) {
      console.error('Error getting phone number:', error);
      return null;
    }
  }

  async setPhoneNumber(clientIP, phoneNumber) {
    try {
      await this.phoneStore.set(clientIP, phoneNumber);
      console.log('Stored phone number:', phoneNumber, 'for IP:', clientIP);
      return true;
    } catch (error) {
      console.error('Error storing phone number:', error);
      return false;
    }
  }

  // Методи для роботи з платежами
  async getPaymentData(sessionId) {
    try {
      return JSON.parse(await this.paymentStore.get(sessionId) || 'null');
    } catch (error) {
      console.error('Error getting payment data:', error);
      return null;
    }
  }

  async setPaymentData(sessionId, paymentData) {
    try {
      await this.paymentStore.set(sessionId, JSON.stringify(paymentData));
      return true;
    } catch (error) {
      console.error('Error storing payment data:', error);
      return false;
    }
  }

  async deletePaymentData(sessionId) {
    try {
      await this.paymentStore.delete(sessionId);
      return true;
    } catch (error) {
      console.error('Error deleting payment data:', error);
      return false;
    }
  }

  // Методи для роботи з повідомленнями Telegram
  async getTelegramMessages() {
    try {
      const data = await this.telegramStore.get('messages');
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error getting telegram messages:', error);
      return {};
    }
  }

  async setTelegramMessage(messageId, messageData) {
    try {
      const messages = await this.getTelegramMessages();
      messages[messageId] = messageData;
      await this.telegramStore.set('messages', JSON.stringify(messages));
      return true;
    } catch (error) {
      console.error('Error storing telegram message:', error);
      return false;
    }
  }

  async deleteTelegramMessage(messageId) {
    try {
      const messages = await this.getTelegramMessages();
      if (messages[messageId]) {
        delete messages[messageId];
        await this.telegramStore.set('messages', JSON.stringify(messages));
      }
      return true;
    } catch (error) {
      console.error('Error deleting telegram message:', error);
      return false;
    }
  }
}

module.exports = new Storage();