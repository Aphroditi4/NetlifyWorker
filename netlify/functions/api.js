const fetch = require('node-fetch');
const url = require('url');
const utils = require('./utils');
const handlers = require('./handlers');
const payment = require('./payment');

// Основной обработчик всех API запросов
exports.handler = async function(event, context) {
  // Для простоты отладки выводим информацию о запросе
  console.log('Request:', {
    path: event.path,
    httpMethod: event.httpMethod,
    headers: event.headers,
    queryStringParameters: event.queryStringParameters
  });

  // Обработка CORS preflight запросов
  if (event.httpMethod === 'OPTIONS') {
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

  // Парсинг запроса
  const requestUrl = new URL(event.path, `https://${event.headers.host || utils.MIRROR_DOMAIN}`);
  
  // Добавляем параметры запроса
  if (event.queryStringParameters) {
    Object.entries(event.queryStringParameters).forEach(([key, value]) => {
      requestUrl.searchParams.append(key, value);
    });
  }

  // Создаем объект запроса для передачи в обработчики
  const request = {
    url: requestUrl.toString(),
    method: event.httpMethod,
    headers: event.headers,
    body: event.body
  };

  try {
    // Обработка различных типов запросов
    
    // Обработка CORS preflight запросов
    if (event.httpMethod === 'OPTIONS') {
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
    
    // Обработка хранения номера телефона
    if (requestUrl.pathname === '/api/store-phone' && event.httpMethod === 'POST') {
      try {
        const data = JSON.parse(event.body);
        const phoneNumber = data.phoneNumber;
        
        if (phoneNumber && phoneNumber.match(/^\d{9}$/)) {
          // В Netlify Functions мы не можем хранить глобальные переменные между вызовами,
          // поэтому здесь мы могли бы использовать cookies или другой механизм хранения.
          // Для простоты просто подтверждаем получение номера.
          
          return {
            statusCode: 200,
            body: 'Phone number stored'
          };
        }
        
        return {
          statusCode: 400,
          body: 'Invalid phone number'
        };
      } catch (e) {
        console.error('Error storing phone:', e);
        
        return {
          statusCode: 500,
          body: 'Error storing phone number'
        };
      }
    }
    
    // Обработка проверки номера телефона
    if (requestUrl.pathname === '/api/check_number_no_captcha' || requestUrl.pathname === '/api/check_number') {
      return await handlers.handleCheckNumberRequest(request, requestUrl);
    }
    
    // Обработка создания платежа
    if (requestUrl.pathname === '/api/create-payment') {
      return await payment.handlePaymentRequest(request);
    }
    
    // Обработка пополнения счета
    if (requestUrl.pathname === '/api/topup') {
      return await payment.handleTopupRequest(request);
    }
    
    // Обработка запросов к store-backend
    if (requestUrl.pathname.startsWith('/store-backend')) {
      return await handlers.handleStoreBackend(request, requestUrl);
    }
    
    // Если это API запрос, обрабатываем его
    if (handlers.isApiRequest(requestUrl)) {
      const modifiedRequest = utils.modifyApiRequest(request, requestUrl);
      const response = await fetch(`https://${utils.SOURCE_DOMAIN}${requestUrl.pathname}${requestUrl.search}`, modifiedRequest);
      
      const responseBody = await response.text();
      const responseHeaders = {};
      
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      responseHeaders['Access-Control-Allow-Origin'] = '*';
      responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      responseHeaders['Access-Control-Allow-Headers'] = '*';
      
      return {
        statusCode: response.status,
        headers: responseHeaders,
        body: responseBody
      };
    }
    
    // Если это не API запрос, проксируем его на оригинальный сайт
    return await handlers.proxyRequest(request, requestUrl);
    
  } catch (error) {
    console.error('Error handling request:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      },
      body: `Error: ${error.message}`
    };
  }
};