const { SOURCE_DOMAIN } = require('./constants');
const fetch = require('node-fetch');
const { modifyHTML, modifyJavaScript } = require('./html-modifier');

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

async function modifyApiRequest(request, url) {
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (!['host', 'origin', 'referer', 'x-forwarded-host', 'x-forwarded-proto'].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  headers['Origin'] = `https://${SOURCE_DOMAIN}`;
  headers['Referer'] = `https://${SOURCE_DOMAIN}/`;

  let bodyContent = null;
  if (['POST', 'PUT', 'PATCH'].includes(request.httpMethod)) {
    const contentType = request.headers['content-type'] || '';
    try {
      if (contentType.includes('application/json')) {
        bodyContent = request.body ? JSON.stringify(JSON.parse(request.body)) : null;
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        bodyContent = request.body; // Already URL-encoded
      } else {
        bodyContent = request.body;
      }
    } catch (e) {
      console.error('Error processing request body:', e);
    }
  }

  try {
    const response = await fetch(`https://${SOURCE_DOMAIN}${url.pathname}${url.search || ''}`, {
      method: request.httpMethod,
      headers: headers,
      body: bodyContent,
      redirect: 'manual'
    });
    
    return response;
  } catch (error) {
    console.error('Error in modifyApiRequest:', error);
    throw error;
  }
}

async function handleStoreBackend(request, url) {
  const newPath = url.pathname.replace(/^\/store-backend/, '');
  const backendUrl = `https://store-backend.digimobil.es${newPath}${url.search || ''}`;
  
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (!['host', 'origin', 'referer', 'x-forwarded-host', 'x-forwarded-proto'].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  headers['Origin'] = 'https://store-backend.digimobil.es';
  headers['Referer'] = 'https://store-backend.digimobil.es/';

  let bodyContent = null;
  if (['POST', 'PUT', 'PATCH'].includes(request.httpMethod)) {
    const contentType = request.headers['content-type'] || '';
    try {
      if (contentType.includes('application/json')) {
        bodyContent = request.body ? JSON.stringify(JSON.parse(request.body)) : null;
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        bodyContent = request.body; // Already URL-encoded
      } else {
        bodyContent = request.body;
      }
    } catch (e) {
      console.error('Error processing request body:', e);
    }
  }

  try {
    const backendResponse = await fetch(backendUrl, {
      method: request.httpMethod,
      headers: headers,
      body: bodyContent,
      redirect: 'manual'
    });

    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    };

    // Додаємо заголовки з відповіді
    for (const [key, value] of Object.entries(backendResponse.headers.raw())) {
      if (!['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].includes(key.toLowerCase())) {
        responseHeaders[key] = value[0];
      }
    }

    const bodyBuffer = await backendResponse.buffer();
    
    return {
      statusCode: backendResponse.status,
      headers: responseHeaders,
      body: bodyBuffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('Error in handleStoreBackend:', error);
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

async function followRedirects(response, headers, maxRedirects = 5) {
  let currentResponse = response;
  let redirectCount = 0;

  while (currentResponse.status >= 300 && currentResponse.status < 400 && redirectCount < maxRedirects) {
    const location = currentResponse.headers.get('Location');
    if (!location) break;

    let redirectUrl = location;
    if (location.startsWith('/')) {
      redirectUrl = `https://${SOURCE_DOMAIN}${location}`;
    } else if (!location.startsWith('http')) {
      redirectUrl = `https://${SOURCE_DOMAIN}/${location}`;
    }

    const redirectRequest = {
      method: 'GET',
      headers: headers,
      redirect: 'manual'
    };

    currentResponse = await fetch(redirectUrl, redirectRequest);
    redirectCount++;
  }

  return currentResponse;
}

async function handleProxyRequest(request) {
  const url = new URL(request.rawUrl || `https://${request.headers.host}${request.path}`);
  
  console.log('Handling proxy request:', { url: url.pathname, method: request.httpMethod });

  if (request.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  if (isApiRequest(url)) {
    const response = await modifyApiRequest(request, url);
    
    let finalResponse = response;
    if (response.status >= 300 && response.status < 400) {
      const headers = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (!['host', 'origin', 'referer'].includes(key.toLowerCase())) {
          headers[key] = value;
        }
      }
      finalResponse = await followRedirects(response, headers);
    }
    
    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    };
    
    // Додаємо заголовки з відповіді
    for (const [key, value] of Object.entries(finalResponse.headers.raw())) {
      if (!['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].includes(key.toLowerCase())) {
        responseHeaders[key] = value[0];
      }
    }
    
    const bodyBuffer = await finalResponse.buffer();
    
    console.log('API response:', { status: finalResponse.status, url: url.pathname });
    
    return {
      statusCode: finalResponse.status,
      headers: responseHeaders,
      body: bodyBuffer.toString('base64'),
      isBase64Encoded: true
    };
  }

  // Для звичайних запитів до сайту
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (!['host', 'origin', 'referer'].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  }

  let bodyContent = null;
  if (['POST', 'PUT', 'PATCH'].includes(request.httpMethod)) {
    try {
      bodyContent = request.body;
    } catch (e) {
      console.error('Error getting request body:', e);
    }
  }

  const proxyRequest = {
    method: request.httpMethod,
    headers: headers,
    body: bodyContent,
    redirect: 'manual'
  };

  let response = await fetch(`https://${SOURCE_DOMAIN}${url.pathname}${url.search || ''}`, proxyRequest);
  if (response.status >= 300 && response.status < 400) {
    response = await followRedirects(response, headers);
  }

  const contentType = response.headers.get('Content-Type') || '';
  console.log('Proxy response:', { status: response.status, contentType, url: url.pathname });

  if (contentType.includes('text/html')) {
    return await modifyHTML(response);
  }
  
  if (contentType.includes('javascript')) {
    return await modifyJavaScript(response);
  }

  const responseHeaders = {};
  for (const [key, value] of Object.entries(response.headers.raw())) {
    responseHeaders[key] = value[0];
  }
  
  responseHeaders['Access-Control-Allow-Origin'] = '*';
  responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  responseHeaders['Access-Control-Allow-Headers'] = '*';
  
  const bodyBuffer = await response.buffer();
  
  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: bodyBuffer.toString('base64'),
    isBase64Encoded: true
  };
}

module.exports = {
  isApiRequest,
  modifyApiRequest,
  handleStoreBackend,
  followRedirects,
  handleProxyRequest
};