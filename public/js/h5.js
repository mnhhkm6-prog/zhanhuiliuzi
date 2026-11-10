(function () {
  const campaignCode = decodeURIComponent(
    (location.pathname.split('/').filter(Boolean).pop() || '').split('?')[0]
  );

  const el = {
    loading: document.getElementById('loading'),
    formPage: document.getElementById('formPage'),
    successPage: document.getElementById('successPage'),
    errorPage: document.getElementById('errorPage'),
    errorTitle: document.getElementById('errorTitle'),
    errorDesc: document.getElementById('errorDesc'),
    campaignName: document.getElementById('campaignName'),
    campaignSub: document.getElementById('campaignSub'),
    campaignDate: document.getElementById('campaignDate'),
    form: document.getElementById('leadForm'),
    dynamicFields: document.getElementById('dynamicFields'),
    submitBtn: document.getElementById('submitBtn'),
    toast: document.getElementById('toast')
  };

  let countdownTimer = null;
  let toastTimer = null;
  let fields = [];
  let successText = '感谢您的填写，请向现场工作人员领取资料';

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    let body = {};
    try {
      body = await res.json();
    } catch (_) {
      body = {};
    }
    if (!res.ok) {
      const error = new Error(body.error || '网络异常，请稍后重试');
      error.status = res.status;
      error.data = body;
      throw error;
    }
    return body;
  }

  function showError(title, desc) {
    el.loading.classList.add('hidden');
    el.formPage.classList.add('hidden');
    el.errorPage.classList.remove('hidden');
    el.errorTitle.textContent = title;
    el.errorDesc.textContent = desc || '';
  }

  function setFieldError(field, message) {
    const wrap = document.getElementById('field-' + field);
    if (!wrap) return;
    wrap.classList.toggle('invalid', !!message);
    const err = wrap.querySelector('.err');
    if (err) err.textContent = message || '';
  }

  function clearErrors() {
    fields.forEach((f) => setFieldError(f.key, ''));
    setFieldError('code', '');
  }

  function makeLabel(text, required, targetId) {
    const label = document.createElement('label');
    label.setAttribute('for', targetId);
    label.textContent = text + ' ';
    if (required) {
      const star = document.createElement('em');
      star.textContent = '*';
      label.appendChild(star);
    }
    return label;
  }

  function makeError() {
    const err = document.createElement('p');
    err.className = 'err';
    return err;
  }

  function renderGenericField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.id = 'field-' + field.key;

    const inputId = 'fld-' + field.key;
    wrap.appendChild(makeLabel(field.label, field.required, inputId));

    let input;
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
      input.maxLength = field.maxLength || 500;
      input.placeholder = field.placeholder || '请输入';
    } else if (field.type === 'select') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = field.placeholder || '请选择';
      input.appendChild(blank);
      (field.options || []).forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        input.appendChild(opt);
      });
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.maxLength = field.maxLength || 100;
      input.placeholder = field.placeholder || '请输入';
    }
    input.id = inputId;
    input.name = field.key;
    wrap.appendChild(input);
    wrap.appendChild(makeError());

    el.dynamicFields.appendChild(wrap);
  }

  /** 手机号 + 短信验证码固定块 */
  function renderPhoneField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.id = 'field-phone';
    wrap.appendChild(makeLabel(field.label || '手机号', true, 'phone'));

    const row = document.createElement('div');
    row.className = 'input-row';

    const phone = document.createElement('input');
    phone.id = 'phone';
    phone.name = 'phone';
    phone.type = 'tel';
    phone.inputMode = 'numeric';
    phone.maxLength = 11;
    phone.placeholder = '请输入 11 位手机号';
    phone.autocomplete = 'tel';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-btn';
    btn.id = 'sendCodeBtn';
    btn.textContent = '获取验证码';

    row.appendChild(phone);
    row.appendChild(btn);
    wrap.appendChild(row);
    wrap.appendChild(makeError());
    el.dynamicFields.appendChild(wrap);

    const codeWrap = document.createElement('div');
    codeWrap.className = 'field';
    codeWrap.id = 'field-code';
    codeWrap.appendChild(makeLabel('短信验证码', true, 'code'));

    const code = document.createElement('input');
    code.id = 'code';
    code.name = 'code';
    code.type = 'text';
    code.inputMode = 'numeric';
    code.maxLength = 6;
    code.placeholder = '请输入 6 位验证码';
    code.autocomplete = 'one-time-code';
    codeWrap.appendChild(code);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.id = 'codeHint';
    codeWrap.appendChild(hint);
    codeWrap.appendChild(makeError());
    el.dynamicFields.appendChild(codeWrap);
  }

  function onlyDigits(input) {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '');
    });
  }

  function renderFields(list) {
    fields = Array.isArray(list) ? list : [];
    el.dynamicFields.innerHTML = '';

    fields.forEach((field) => {
      if (field.key === 'phone') renderPhoneField(field);
      else renderGenericField(field);
    });

    const phoneInput = document.getElementById('phone');
    const codeInput = document.getElementById('code');
    if (phoneInput) onlyDigits(phoneInput);
    if (codeInput) onlyDigits(codeInput);
    bindSendCode();
  }

  function startCountdown(seconds) {
    clearInterval(countdownTimer);
    let left = seconds;
    const btn = document.getElementById('sendCodeBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = `重新获取(${left}s)`;
    countdownTimer = setInterval(() => {
      left -= 1;
      const button = document.getElementById('sendCodeBtn');
      if (!button) {
        clearInterval(countdownTimer);
        return;
      }
      if (left <= 0) {
        clearInterval(countdownTimer);
        button.disabled = false;
        button.textContent = '重新获取';
      } else {
        button.textContent = `重新获取(${left}s)`;
      }
    }, 1000);
  }

  function isPhone(value) {
    return /^1[3-9]\d{9}$/.test(value);
  }

  function bindSendCode() {
    const btn = document.getElementById('sendCodeBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const phone = document.getElementById('phone').value.trim();
      if (!phone) {
        setFieldError('phone', '请先填写手机号');
        document.getElementById('phone').focus();
        return;
      }
      if (!isPhone(phone)) {
        setFieldError('phone', '请输入正确的 11 位手机号');
        document.getElementById('phone').focus();
        return;
      }
      setFieldError('phone', '');
      btn.disabled = true;
      btn.textContent = '发送中…';

      try {
        const result = await api('/api/public/sms/send', {
          method: 'POST',
          body: JSON.stringify({ campaignCode, phone })
        });
        startCountdown(result.resendAfter || 60);
        const hint = document.getElementById('codeHint');
        if (result.devCode) {
          document.getElementById('code').value = result.devCode;
          hint.textContent = `测试模式验证码：${result.devCode}（正式环境将通过短信下发）`;
          hint.classList.add('dev');
        } else {
          hint.textContent = '验证码 5 分钟内有效，请留意短信';
          hint.classList.remove('dev');
        }
        showToast('验证码已发送');
      } catch (err) {
        if (err.status === 429 && err.data && err.data.retryAfter) {
          startCountdown(err.data.retryAfter);
        } else {
          btn.disabled = false;
          btn.textContent = '获取验证码';
        }
        showToast(err.message);
      }
    });
  }

  async function loadCampaign() {
    if (!campaignCode) {
      showError('二维码无效', '请重新扫描展台二维码');
      return;
    }
    try {
      const campaign = await api('/api/public/campaigns/' + encodeURIComponent(campaignCode));
      document.title = campaign.name + ' - 留资登记';
      el.campaignName.textContent = campaign.name;
      el.campaignSub.textContent = campaign.subtitle || '填写以下信息，现场领取资料 / 礼品';
      successText = campaign.successText || successText;
      el.campaignDate.textContent =
        campaign.startDate || campaign.endDate
          ? `时间：${campaign.startDate || ''}${campaign.startDate && campaign.endDate ? ' 至 ' : ''}${campaign.endDate || ''}`
          : '';

      if (!campaign.submitEnabled) {
        showError('活动已结束', '感谢您的关注，如需资料请联系现场工作人员');
        return;
      }

      renderFields(campaign.formFields);
      el.loading.classList.add('hidden');
      el.formPage.classList.remove('hidden');
    } catch (err) {
      if (err.status === 404) {
        showError('二维码无效或活动不存在', '请联系现场工作人员获取正确的二维码');
      } else {
        showError('页面加载失败', err.message || '请检查网络后刷新重试');
      }
    }
  }

  el.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();

    const payload = {
      campaignCode,
      name: '',
      company: '',
      position: '',
      phone: '',
      code: '',
      extra: {}
    };
    let invalid = false;

    fields.forEach((field) => {
      if (field.key === 'phone') {
        const phoneInput = document.getElementById('phone');
        const phone = phoneInput ? phoneInput.value.trim() : '';
        payload.phone = phone;
        if (!phone) {
          setFieldError('phone', '请填写手机号');
          invalid = true;
        } else if (!isPhone(phone)) {
          setFieldError('phone', '请输入正确的 11 位手机号');
          invalid = true;
        }
        return;
      }

      const input = document.getElementById('fld-' + field.key);
      const value = input ? input.value.trim() : '';

      if (field.key === 'name' || field.key === 'company' || field.key === 'position') {
        payload[field.key] = value;
        if (!value) {
          if (field.required) {
            setFieldError(field.key, '请填写' + field.label);
            invalid = true;
          }
          return;
        }
        if (value.length > field.maxLength) {
          setFieldError(field.key, `${field.label}不能超过 ${field.maxLength} 个字符`);
          invalid = true;
        }
        return;
      }

      if (!value) {
        if (field.required) {
          setFieldError(field.key, '请填写' + field.label);
          invalid = true;
        }
        return;
      }
      if (value.length > field.maxLength) {
        setFieldError(field.key, `${field.label}不能超过 ${field.maxLength} 个字符`);
        invalid = true;
        return;
      }
      payload.extra[field.key] = value;
    });

    const codeInput = document.getElementById('code');
    payload.code = codeInput ? codeInput.value.trim() : '';
    if (!payload.code) {
      setFieldError('code', '请填写短信验证码');
      invalid = true;
    } else if (!/^\d{6}$/.test(payload.code)) {
      setFieldError('code', '验证码为 6 位数字');
      invalid = true;
    }

    if (invalid) return;

    el.submitBtn.disabled = true;
    el.submitBtn.textContent = '提交中…';

    try {
      await api('/api/public/leads', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      el.formPage.classList.add('hidden');
      el.successPage.classList.remove('hidden');
      document.getElementById('successDesc').textContent = successText;
      window.scrollTo(0, 0);
    } catch (err) {
      if (err.message.indexOf('验证码') > -1) {
        setFieldError('code', err.message);
      } else {
        const matched = fields.find((f) => err.message.indexOf(f.label) > -1);
        if (matched) setFieldError(matched.key, err.message);
      }
      showToast(err.message);
    } finally {
      el.submitBtn.disabled = false;
      el.submitBtn.textContent = '提交';
    }
  });

  loadCampaign();
})();
