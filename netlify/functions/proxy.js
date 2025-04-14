const { handleProxyRequest } = require('./utils/proxy');

exports.handler = async (event, context) => {
  try {
    return await handleProxyRequest(event);
  } catch (error) {
    console.error('Error in proxy handler:', error);
    
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