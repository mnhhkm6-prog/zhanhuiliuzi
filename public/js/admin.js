(function () {
  const $ = (id) => document.getElementById(id);

  const state = {
    admin: null,
    view: 'dashboard',
    campaigns: [],
    formCampaignId: '',
    leads: { page: 1, pageSize: 20, total: 0, filters: { campaignId: '', from: '', to: '', keyword: '' } }
  };

  const VIEW_TITLES = {
    dashboard: '数据概览',
    campaigns: '活动与二维码',
    form: '表单编辑',
    leads: '留资数据',
    exports: '导出记录',
    settings: '系统设置'
  };

  const STATUS_MAP = {
    active: { text: '进行中', cls: 'green' },
    ended: { text: '已结束', cls: 'gray' },
    disabled: { text: '已停用', cls: 'orange' }
  };

  let toastTimer = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function time(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toast(message, isError) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });

    if (res.status === 401) {
      showLogin();
      throw new Error('登录已过期，请重新登录');
    }

    let data = null;
    const type = res.headers.get('content-type') || '';
    if (type.indexOf('application/json') > -1) data = await res.json();

    if (!res.ok) throw new Error((data && data.error) || `请求失败（${res.status}）`);
    return data;
  }

  /* ---------------- 登录 ---------------- */
  function showLogin() {
    $('app').classList.add('hidden');
    $('loginPage').classList.remove('hidden');
    $('loginPassword').value = '';
  }

  function showApp() {
    $('loginPage').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('adminName').textContent = state.admin ? state.admin.username : '';
  }

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('loginUsername').value.trim();
    const password = $('loginPassword').value;
    $('loginErr').textContent = '';

    if (!username || !password) {
      $('loginErr').textContent = '请输入账号和密码';
      return;
    }

    $('loginBtn').disabled = true;
    $('loginBtn').textContent = '登录中…';
    try {
      const data = await api('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      state.admin = data;
      showApp();
      go(location.hash.replace('#/', '') || 'dashboard');
    } catch (err) {
      $('loginErr').textContent = err.message;
    } finally {
      $('loginBtn').disabled = false;
      $('loginBtn').textContent = '登录';
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try {
      await api('/api/admin/auth/logout', { method: 'POST' });
    } catch (_) {
      /* ignore */
    }
    state.admin = null;
    showLogin();
  });

  /* ---------------- 路由 ---------------- */
  document.querySelectorAll('#nav a').forEach((link) => {
    link.addEventListener('click', () => {
      location.hash = '#/' + link.dataset.view;
    });
  });

  function go(view) {
    if (!VIEW_TITLES[view]) view = 'dashboard';
    state.view = view;
    document.querySelectorAll('#nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach((section) => {
      section.classList.toggle('hidden', section.id !== 'view-' + view);
    });
    $('viewTitle').textContent = VIEW_TITLES[view];
    renderActions(view);

    if (view === 'dashboard') loadDashboard();
    if (view === 'campaigns') loadCampaigns();
    if (view === 'form') loadFormEditor();
    if (view === 'leads') fillCampaignFilter().then(() => loadLeads());
    if (view === 'exports') loadExports();
    if (view === 'settings') loadSettings();
  }

  window.addEventListener('hashchange', () => {
    if (state.admin) go(location.hash.replace('#/', ''));
  });

  function renderActions(view) {
    const box = $('viewActions');
    box.innerHTML = '';
    if (view === 'campaigns') {
      box.innerHTML = '<button class="btn-primary" id="newCampaignBtn">+ 新建活动</button>';
      $('newCampaignBtn').addEventListener('click', () => openCampaignModal(null));
    } else if (view === 'form') {
      box.innerHTML = '<button class="btn-ghost" id="backToCampaigns">返回活动列表</button>';
      $('backToCampaigns').addEventListener('click', () => { location.hash = '#/campaigns'; });
    } else if (view === 'leads') {
      box.innerHTML = '<button class="btn-primary" id="exportBtn">导出 Excel</button>';
      $('exportBtn').addEventListener('click', exportLeads);
    }
  }

  /* ---------------- 概览 ---------------- */
  async function loadDashboard() {
    try {
      const data = await api('/api/admin/dashboard');
      const { totals, sms } = data;
      $('statGrid').innerHTML = [
        statCard('今日留资', totals.todayLeads, '条'),
        statCard('累计留资', totals.leads, '条'),
        statCard('进行中活动', totals.activeCampaigns, `共 ${totals.campaigns} 场`),
        statCard('今日验证码成功率', sms.successRate == null ? '—' : sms.successRate + '%', `发送 ${sms.todaySent} 条 / 失败 ${sms.todayFailed} 条`)
      ].join('');

      const max = Math.max(1, ...data.trend.map((t) => t.count));
      $('trendChart').innerHTML = data.trend
        .map(
          (t) => `
          <div class="bar-wrap">
            <span class="bar-value">${t.count}</span>
            <div class="bar" style="height:${Math.round((t.count / max) * 130) + 4}px"></div>
            <span class="bar-label">${t.date.slice(5)}</span>
          </div>`
        )
        .join('');

      $('rankBody').innerHTML = data.ranking.length
        ? data.ranking
            .map(
              (c) => `<tr>
                <td>${esc(c.name)}</td>
                <td><b>${c.leadCount}</b></td>
                <td>${c.todayCount}</td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="3" class="empty">暂无数据</td></tr>';

      $('recentBody').innerHTML = data.recentLeads.length
        ? data.recentLeads
            .map(
              (l) => `<tr>
                <td>${esc(l.name)}</td>
                <td>${esc(l.company)}</td>
                <td>${esc(l.campaignName)}</td>
                <td>${time(l.submittedAt)}</td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="4" class="empty">暂无留资</td></tr>';
    } catch (err) {
      if (err.message.indexOf('登录') === -1) toast(err.message, true);
    }
  }

  function statCard(label, value, extra) {
    return `<div class="stat">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="extra">${extra || ''}</div>
    </div>`;
  }

  /* ---------------- 活动 ---------------- */
  async function loadCampaigns() {
    try {
      const data = await api('/api/admin/campaigns');
      state.campaigns = data.list;
      $('campaignTotal').textContent = data.total;

      $('campaignBody').innerHTML = data.list.length
        ? data.list
            .map((c) => {
              const s = STATUS_MAP[c.status] || { text: c.status, cls: 'gray' };
              const nextStatus = c.status === 'active' ? 'disabled' : 'active';
              return `<tr>
                <td>${esc(c.name)}</td>
                <td>${esc(c.code)}</td>
                <td>${esc(c.startDate || '')}${c.startDate && c.endDate ? ' ~ ' : ''}${esc(c.endDate || '')}</td>
                <td><span class="badge ${s.cls}">${s.text}</span></td>
                <td>${c.leadCount}</td>
                <td class="actions">
                  <button class="btn-link" data-fields="${c.id}">表单编辑</button>
                  <button class="btn-link" data-qr="${c.id}">二维码</button>
                  <button class="btn-link" data-edit="${c.id}">编辑</button>
                  <button class="btn-link ${nextStatus === 'disabled' ? 'danger' : ''}" data-toggle="${c.id}">${nextStatus === 'disabled' ? '停用' : '启用'}</button>
                  <button class="btn-link danger" data-remove="${c.id}">删除</button>
                </td>
              </tr>`;
            })
            .join('')
        : '<tr><td colspan="7" class="empty">还没有活动，点击右上角「新建活动」创建第一场展会</td></tr>';

      $('campaignBody').querySelectorAll('[data-fields]').forEach((btn) => {
        btn.addEventListener('click', () => openFormEditor(btn.dataset.fields));
      });
      $('campaignBody').querySelectorAll('[data-qr]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const campaign = state.campaigns.find((c) => c.id === btn.dataset.qr);
          openQrModal(campaign);
        });
      });
      $('campaignBody').querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const campaign = state.campaigns.find((c) => c.id === btn.dataset.edit);
          openCampaignModal(campaign);
        });
      });
      $('campaignBody').querySelectorAll('[data-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => toggleCampaign(btn.dataset.toggle));
      });
      $('campaignBody').querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => removeCampaign(btn.dataset.remove));
      });
    } catch (err) {
      if (err.message.indexOf('登录') === -1) toast(err.message, true);
    }
  }

  async function toggleCampaign(id) {
    const campaign = state.campaigns.find((c) => c.id === id);
    if (!campaign) return;
    const next = campaign.status === 'active' ? 'disabled' : 'active';
    if (!confirm(`确定要${next === 'active' ? '启用' : '停用'}活动「${campaign.name}」吗？${next === 'disabled' ? '停用后扫码将无法提交。' : ''}`)) return;
    try {
      await api(`/api/admin/campaigns/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: campaign.name,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
          status: next
        })
      });
      toast('已' + (next === 'active' ? '启用' : '停用'));
      loadCampaigns();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function removeCampaign(id) {
    const campaign = state.campaigns.find((c) => c.id === id);
    if (!campaign) return;
    if (!confirm(`确定删除活动「${campaign.name}」吗？删除后二维码将失效，且不可恢复。`)) return;
    try {
      await api(`/api/admin/campaigns/${id}`, { method: 'DELETE' });
      toast('活动已删除');
      loadCampaigns();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function openCampaignModal(campaign) {
    const isEdit = !!campaign;
    openModal(
      `<h3>${isEdit ? '编辑活动' : '新建活动'}</h3>
      <form id="campaignForm" class="form-grid">
        <div class="form-item full">
          <label>活动名称 *</label>
          <input id="cName" maxlength="60" value="${esc(campaign ? campaign.name : '')}" placeholder="如：2026 深圳国际工业展" />
        </div>
        <div class="form-item">
          <label>开始日期</label>
          <input id="cStart" type="date" value="${esc(campaign ? campaign.startDate : '')}" />
        </div>
        <div class="form-item">
          <label>结束日期</label>
          <input id="cEnd" type="date" value="${esc(campaign ? campaign.endDate : '')}" />
        </div>
        <div class="form-item">
          <label>状态</label>
          <select id="cStatus">
            <option value="active" ${campaign && campaign.status === 'active' ? 'selected' : ''}>进行中</option>
            <option value="ended" ${campaign && campaign.status === 'ended' ? 'selected' : ''}>已结束</option>
            <option value="disabled" ${campaign && campaign.status === 'disabled' ? 'selected' : ''}>已停用</option>
          </select>
        </div>
      </form>
      <div class="modal-foot">
        <button class="btn-ghost" id="campaignCancel">取消</button>
        <button class="btn-primary" id="campaignSave">保存</button>
      </div>`
    );

    $('campaignCancel').addEventListener('click', closeModal);
    $('campaignSave').addEventListener('click', async () => {
      const payload = {
        name: $('cName').value.trim(),
        startDate: $('cStart').value,
        endDate: $('cEnd').value,
        status: $('cStatus').value
      };
      if (!payload.name) {
        toast('请填写活动名称', true);
        return;
      }
      $('campaignSave').disabled = true;
      try {
        if (isEdit) {
          await api('/api/admin/campaigns/' + campaign.id, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await api('/api/admin/campaigns', { method: 'POST', body: JSON.stringify(payload) });
        }
        toast(isEdit ? '活动已更新' : '活动已创建，可查看二维码');
        closeModal();
        loadCampaigns();
      } catch (err) {
        toast(err.message, true);
      } finally {
        const btn = $('campaignSave');
        if (btn) btn.disabled = false;
      }
    });
  }

  function openQrModal(campaign) {
    const url = campaign.formUrl || `${location.origin}/c/${campaign.code}`;
    openModal(
      `<h3>${esc(campaign.name)} · 活动二维码</h3>
      <div class="qr-box">
        <img src="/api/admin/campaigns/${campaign.id}/qrcode?t=${Date.now()}" alt="活动二维码" />
      </div>
      <div class="qr-link">${esc(url)}</div>
      <div class="modal-foot">
        <button class="btn-ghost" id="copyLink">复制链接</button>
        <button class="btn-ghost" id="openForm">预览表单</button>
        <a class="btn-ghost" style="line-height:34px;text-decoration:none;display:inline-block" href="/api/admin/campaigns/${campaign.id}/qrcode?format=svg&download=1">下载 SVG</a>
        <a class="btn-primary" style="line-height:40px;text-decoration:none;display:inline-block" href="/api/admin/campaigns/${campaign.id}/qrcode?download=1">下载 PNG</a>
      </div>`
    );

    $('copyLink').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('链接已复制');
      } catch (_) {
        toast('复制失败，请手动复制链接', true);
      }
    });
    $('openForm').addEventListener('click', () => window.open(`/c/${campaign.code}`, '_blank'));
  }

  /* ---------------- 表单编辑 ---------------- */
  function openFormEditor(campaignId) {
    state.formCampaignId = campaignId;
    if (location.hash === '#/form') go('form');
    else location.hash = '#/form';
  }

  async function loadFormEditor() {
    const box = $('formEditor');
    const campaignId = state.formCampaignId;
    if (!campaignId) {
      box.innerHTML = '<div class="panel"><p>请从活动列表点击「表单编辑」进入</p></div>';
      return;
    }
    box.innerHTML = '<div class="panel"><p style="color:#8f959e">加载中…</p></div>';
    try {
      let campaign = state.campaigns.find((c) => c.id === campaignId);
      if (!campaign) {
        const data = await api('/api/admin/campaigns');
        state.campaigns = data.list || [];
        campaign = state.campaigns.find((c) => c.id === campaignId);
      }
      if (!campaign) throw new Error('活动不存在或已被删除');
      const config = await api(`/api/admin/campaigns/${campaignId}/form-fields`);
      renderFormEditor(campaign, config.fields || [], config.subtitle || '', config.successText || '');
    } catch (err) {
      box.innerHTML = `<div class="panel"><p style="color:#f54a45">${esc(err.message)}</p></div>`;
    }
  }

  function renderFormEditor(campaign, initialFields, subtitle, successText) {
    const typeOptions = [
      { value: 'text', label: '单行文本' },
      { value: 'textarea', label: '多行文本' },
      { value: 'select', label: '单选下拉' }
    ];
    let fields = JSON.parse(JSON.stringify(initialFields));

    const box = $('formEditor');
    box.innerHTML = `
      <div class="panel">
        <h2>页面文案</h2>
        <div class="form-grid">
          <div class="form-item full">
            <label>主标题</label>
            <input id="pcName" maxlength="60" value="${esc(campaign.name)}" />
          </div>
          <div class="form-item full">
            <label>副标题</label>
            <textarea id="pcSubtitle" maxlength="500" rows="3" placeholder="填写以下信息，现场领取资料 / 礼品">${esc(subtitle)}</textarea>
          </div>
          <div class="form-item full">
            <label>提交成功提示语</label>
            <input id="pcSuccess" maxlength="100" value="${esc(successText)}" placeholder="感谢您的填写，请向现场工作人员领取资料" />
          </div>
          <div class="form-item">
            <label>开始日期</label>
            <input id="pcStart" type="date" value="${esc(campaign.startDate || '')}" />
          </div>
          <div class="form-item">
            <label>结束日期</label>
            <input id="pcEnd" type="date" value="${esc(campaign.endDate || '')}" />
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>表单字段</h2>
        <p class="modal-tip">手机号与短信验证码为固定项（不可删除、不可改类型）；其余字段可改标题、是否必填与顺序。</p>
        <table class="fields-table">
          <thead>
            <tr><th style="width:26%">字段标题</th><th style="width:16%">类型</th><th>选项（下拉使用，逗号分隔）</th><th style="width:8%">必填</th><th style="width:16%">操作</th></tr>
          </thead>
          <tbody id="fieldsBody"></tbody>
        </table>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px">
          <button class="btn-ghost" id="addFieldBtn" type="button">+ 添加字段</button>
          <div style="display:flex; gap:10px">
            <button class="btn-ghost" id="previewFormBtn" type="button">预览表单</button>
            <button class="btn-primary" id="formSave" type="button">保存</button>
          </div>
        </div>
      </div>`;

    const body = $('fieldsBody');

    function optionsText(field) {
      if (Array.isArray(field.optionsRaw)) return field.optionsRaw.join(',');
      if (typeof field.optionsRaw === 'string') return field.optionsRaw;
      return (field.options || []).join(',');
    }

    function readDom() {
      fields = [...body.querySelectorAll('tr')]
        .filter((tr) => tr.querySelector('.f-label'))
        .map((tr) => {
          const locked = tr.dataset.locked === '1';
          return {
            key: tr.dataset.key || '',
            label: tr.querySelector('.f-label').value.trim(),
            type: locked ? 'phone' : tr.querySelector('.f-type').value,
            optionsRaw: locked ? '' : tr.querySelector('.f-options').value,
            required: locked ? true : tr.querySelector('.f-required').checked
          };
        });
    }

    function render() {
      body.innerHTML = fields.length
        ? fields
            .map((field, index) => {
              const locked = field.key === 'phone';
              return `<tr data-key="${esc(field.key || '')}" data-locked="${locked ? '1' : '0'}">
                <td><input class="f-label" maxlength="30" value="${esc(field.label || '')}" placeholder="如：感兴趣的产品" ${locked ? 'disabled' : ''} /></td>
                <td>${
                  locked
                    ? '<span class="badge gray">手机号+验证码</span>'
                    : `<select class="f-type">${typeOptions
                        .map((o) => `<option value="${o.value}" ${field.type === o.value ? 'selected' : ''}>${o.label}</option>`)
                        .join('')}</select>`
                }</td>
                <td>${
                  locked
                    ? '<span style="color:#8f959e">系统固定</span>'
                    : `<input class="f-options" value="${esc(optionsText(field))}" placeholder="如：A,B,C" ${field.type === 'select' ? '' : 'disabled'} />`
                }</td>
                <td style="text-align:center"><input type="checkbox" class="f-required" ${field.required ? 'checked' : ''} ${locked ? 'disabled' : ''} /></td>
                <td class="actions">
                  <button class="btn-link" data-up="${index}" ${index === 0 ? 'disabled' : ''}>上移</button>
                  <button class="btn-link" data-down="${index}" ${index === fields.length - 1 ? 'disabled' : ''}>下移</button>
                  ${locked ? '' : `<button class="btn-link danger" data-del="${index}">删除</button>`}
                </td>
              </tr>`;
            })
            .join('')
        : '<tr><td colspan="5" class="empty">暂无字段，点击「添加字段」</td></tr>';

      body.querySelectorAll('.f-type').forEach((select) => {
        select.addEventListener('change', () => {
          const optionsInput = select.closest('tr').querySelector('.f-options');
          if (select.value === 'select') {
            optionsInput.disabled = false;
            optionsInput.focus();
          } else {
            optionsInput.disabled = true;
            optionsInput.value = '';
          }
        });
      });
      body.querySelectorAll('[data-up]').forEach((btn) =>
        btn.addEventListener('click', () => moveField(Number(btn.dataset.up), -1))
      );
      body.querySelectorAll('[data-down]').forEach((btn) =>
        btn.addEventListener('click', () => moveField(Number(btn.dataset.down), 1))
      );
      body.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', () => removeField(Number(btn.dataset.del)))
      );
    }

    function moveField(index, delta) {
      readDom();
      const target = index + delta;
      if (target < 0 || target >= fields.length) return;
      const [item] = fields.splice(index, 1);
      fields.splice(target, 0, item);
      render();
    }

    function removeField(index) {
      readDom();
      fields.splice(index, 1);
      render();
    }

    render();

    $('addFieldBtn').addEventListener('click', () => {
      readDom();
      if (fields.length >= 14) {
        toast('表单字段最多 14 个', true);
        return;
      }
      fields.push({ key: '', label: '', type: 'text', optionsRaw: '', required: false });
      render();
      const labels = body.querySelectorAll('.f-label');
      if (labels.length) labels[labels.length - 1].focus();
    });

    $('previewFormBtn').addEventListener('click', () => {
      window.open('/c/' + campaign.code, '_blank');
    });

    $('formSave').addEventListener('click', async () => {
      readDom();

      const payloadFields = fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        options:
          field.type === 'select'
            ? String(field.optionsRaw || '')
                .split(/[,，|]/)
                .map((s) => s.trim())
                .filter(Boolean)
            : []
      }));

      if (payloadFields.some((f) => !f.label)) {
        toast('请填写字段标题', true);
        return;
      }
      const badSelect = payloadFields.find((f) => f.type === 'select' && f.options.length < 2);
      if (badSelect) {
        toast(`「${badSelect.label}」至少填写 2 个选项`, true);
        return;
      }

      const pagePayload = {
        name: $('pcName').value.trim(),
        subtitle: $('pcSubtitle').value.trim(),
        successText: $('pcSuccess').value.trim(),
        startDate: $('pcStart').value,
        endDate: $('pcEnd').value,
        status: campaign.status
      };
      if (!pagePayload.name) {
        toast('请填写主标题', true);
        return;
      }

      $('formSave').disabled = true;
      try {
        await api(`/api/admin/campaigns/${campaign.id}`, {
          method: 'PUT',
          body: JSON.stringify(pagePayload)
        });
        await api(`/api/admin/campaigns/${campaign.id}/form-fields`, {
          method: 'PUT',
          body: JSON.stringify({ fields: payloadFields })
        });
        toast('已保存，扫码页立即生效');
        await loadCampaigns();
        await loadFormEditor();
      } catch (err) {
        toast(err.message, true);
      } finally {
        const btn = $('formSave');
        if (btn) btn.disabled = false;
      }
    });
  }

  /* ---------------- 留资列表 ---------------- */
  async function loadLeads(resetPage) {
    if (resetPage) state.leads.page = 1;
    const f = state.leads.filters;
    const params = new URLSearchParams({
      page: state.leads.page,
      pageSize: state.leads.pageSize
    });
    if (f.campaignId) params.set('campaignId', f.campaignId);
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    if (f.keyword) params.set('keyword', f.keyword);

    try {
      const data = await api('/api/admin/leads?' + params.toString());
      state.leads.total = data.total;

      $('leadBody').innerHTML = data.list.length
        ? data.list
            .map(
              (l) => `<tr>
                <td>${esc(l.name)}</td>
                <td>${esc(l.company)}</td>
                <td>${esc(l.position)}</td>
                <td><span id="phone-${l.id}">${esc(l.phoneMasked)}</span>
                  <button class="btn-link" data-phone="${l.id}">查看</button></td>
                <td>${esc(l.campaignName)}</td>
                <td>${l.smsVerified ? '<span class="badge green">已验证</span>' : '<span class="badge gray">未验证</span>'}</td>
                <td>${time(l.submittedAt)}${l.updateCount ? ` <span class="badge gray">更新${l.updateCount}</span>` : ''}</td>
                <td class="actions"><button class="btn-link" data-detail="${l.id}">详情</button></td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="8" class="empty">暂无留资数据</td></tr>';

      $('leadBody').querySelectorAll('[data-phone]').forEach((btn) => {
        btn.addEventListener('click', () => revealPhone(btn.dataset.phone));
      });
      $('leadBody').querySelectorAll('[data-detail]').forEach((btn) => {
        btn.addEventListener('click', () => openLeadDetail(btn.dataset.detail));
      });

      renderPager(data.page, data.pageSize, data.total);
    } catch (err) {
      if (err.message.indexOf('登录') === -1) toast(err.message, true);
    }
  }

  function renderPager(page, pageSize, total) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    $('leadPager').innerHTML = `
      <span>共 ${total} 条 · 第 ${page} / ${pages} 页</span>
      <button id="prevPage" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <button id="nextPage" ${page >= pages ? 'disabled' : ''}>下一页</button>`;
    const prev = $('prevPage');
    const next = $('nextPage');
    if (prev) prev.addEventListener('click', () => { state.leads.page = page - 1; loadLeads(); });
    if (next) next.addEventListener('click', () => { state.leads.page = page + 1; loadLeads(); });
  }

  async function revealPhone(id) {
    try {
      const data = await api(`/api/admin/leads/${id}/phone`);
      const span = $('phone-' + id);
      if (span) span.textContent = data.phone;
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function openLeadDetail(id) {
    try {
      const lead = await api('/api/admin/leads/' + id);
      const ci = lead.clientInfo || {};
      const campaign = state.campaigns.find((c) => c.id === lead.campaignId);
      const extraRows = Object.entries(lead.extra || {})
        .map(([key, value]) => {
          const field = ((campaign && campaign.formFields) || []).find((f) => f.key === key);
          return `<dt>${esc(field ? field.label : key)}</dt><dd style="white-space:pre-wrap">${esc(value)}</dd>`;
        })
        .join('');
      openModal(
        `<h3>留资详情</h3>
        <dl class="detail-list">
          <dt>姓名</dt><dd>${esc(lead.name)}</dd>
          <dt>公司名称</dt><dd>${esc(lead.company)}</dd>
          <dt>职位</dt><dd>${esc(lead.position)}</dd>
          <dt>手机号</dt><dd>${esc(lead.phoneMasked)}</dd>
          <dt>所属活动</dt><dd>${esc(lead.campaignName)}</dd>
          ${extraRows}
          <dt>短信验证</dt><dd>${lead.smsVerified ? '已验证' : '未验证'}</dd>
          <dt>来源</dt><dd>${lead.source === 'qrcode' ? '扫码填写' : esc(lead.source || '-')}</dd>
          <dt>首次提交</dt><dd>${time(lead.submittedAt)}</dd>
          <dt>最近更新</dt><dd>${time(lead.updatedAt)}（更新 ${lead.updateCount} 次）</dd>
          <dt>提交 IP</dt><dd>${esc(ci.ip || '-')}</dd>
          <dt>客户端</dt><dd style="color:#8f959e">${esc(ci.ua || '-')}</dd>
        </dl>
        <div class="modal-foot">
          <button class="btn-ghost" id="detailPhone">查看完整手机号</button>
          <button class="btn-primary" id="detailClose">关闭</button>
        </div>`
      );
      $('detailClose').addEventListener('click', closeModal);
      $('detailPhone').addEventListener('click', async () => {
        try {
          const data = await api(`/api/admin/leads/${id}/phone`);
          toast('手机号：' + data.phone);
        } catch (err) {
          toast(err.message, true);
        }
      });
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function exportLeads() {
    // 以当前筛选框的值为准，避免输入后未点「查询」就导出导致条件丢失
    const f = {
      campaignId: $('leadCampaign').value,
      from: $('leadFrom').value,
      to: $('leadTo').value,
      keyword: $('leadKeyword').value.trim()
    };
    state.leads.filters = f;
    const params = new URLSearchParams();
    if (f.campaignId) params.set('campaignId', f.campaignId);
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    if (f.keyword) params.set('keyword', f.keyword);

    const btn = $('exportBtn');
    btn.disabled = true;
    btn.textContent = '导出中…';
    try {
      const res = await fetch('/api/admin/leads/export?' + params.toString());
      if (res.status === 401) {
        showLogin();
        return;
      }
      if (!res.ok) {
        let message = '导出失败';
        try {
          const data = await res.json();
          message = data.error || message;
        } catch (_) {
          /* ignore */
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
      const fileName = match ? decodeURIComponent(match[1]) : '留资数据.xlsx';

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      const rows = res.headers.get('x-row-count');
      toast(rows ? `导出成功，共 ${rows} 条` : '导出成功');
      loadLeads(true);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '导出 Excel';
    }
  }

  /* ---------------- 导出记录 ---------------- */
  async function loadExports() {
    try {
      const data = await api('/api/admin/leads/export-logs');
      $('exportBody').innerHTML = data.list.length
        ? data.list
            .map((log) => {
              const f = log.filterSnapshot || {};
              const conditions = [];
              conditions.push(log.campaignName || '全部活动');
              if (f.from || f.to) conditions.push(`${f.from || '不限'} ~ ${f.to || '不限'}`);
              if (f.keyword) conditions.push('关键词：' + f.keyword);
              return `<tr>
                <td>${esc(log.fileName)}</td>
                <td>${log.rowCount}</td>
                <td>${esc(conditions.join(' · '))}</td>
                <td>${esc(log.adminName)}</td>
                <td>${time(log.createdAt)}</td>
                <td><a class="btn-link" href="/api/admin/leads/export-logs/${log.id}/download">下载</a></td>
              </tr>`;
            })
            .join('')
        : '<tr><td colspan="6" class="empty">暂无导出记录</td></tr>';
    } catch (err) {
      if (err.message.indexOf('登录') === -1) toast(err.message, true);
    }
  }

  /* ---------------- 设置 ---------------- */
  async function loadSettings() {
    try {
      const s = await api('/api/admin/settings');
      $('setSmsProvider').value = s.smsProvider;
      $('setIhuyiAccount').value = s.ihuyiAccount || '';
      $('setIhuyiApiKey').value = s.ihuyiApiKey || '';
      $('setIhuyiTemplateId').value = s.ihuyiTemplateId || '1';
      $('setSmsEndpoint').value = s.smsEndpoint || '';
      $('setSmsAppKey').value = s.smsAppKey || '';
      $('setSmsAppSecret').value = s.smsAppSecret || '';
      $('setSmsSignName').value = s.smsSignName || '';
      $('setSmsTemplateCode').value = s.smsTemplateCode || '';
      $('setSmsTestMode').checked = !!s.smsTestMode;
      $('setCodeExpire').value = s.codeExpireSeconds;
      $('setResendInterval').value = s.resendIntervalSeconds;
      $('setDailyLimit').value = s.dailyLimitPerPhone;
      $('setMaxAttempts').value = s.maxVerifyAttempts;
    } catch (err) {
      if (err.message.indexOf('登录') === -1) toast(err.message, true);
    }
  }

  $('settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          smsProvider: $('setSmsProvider').value,
          ihuyiAccount: $('setIhuyiAccount').value.trim(),
          ihuyiApiKey: $('setIhuyiApiKey').value,
          ihuyiTemplateId: $('setIhuyiTemplateId').value.trim() || '1',
          smsEndpoint: $('setSmsEndpoint').value.trim(),
          smsAppKey: $('setSmsAppKey').value.trim(),
          smsAppSecret: $('setSmsAppSecret').value,
          smsSignName: $('setSmsSignName').value.trim(),
          smsTemplateCode: $('setSmsTemplateCode').value.trim(),
          smsTestMode: $('setSmsTestMode').checked,
          codeExpireSeconds: Number($('setCodeExpire').value),
          resendIntervalSeconds: Number($('setResendInterval').value),
          dailyLimitPerPhone: Number($('setDailyLimit').value),
          maxVerifyAttempts: Number($('setMaxAttempts').value)
        })
      });
      toast('配置已保存');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('testSmsBtn').addEventListener('click', async () => {
    const phone = $('testPhone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      toast('请输入正确的 11 位手机号', true);
      return;
    }
    const btn = $('testSmsBtn');
    btn.disabled = true;
    btn.textContent = '发送中…';
    try {
      const result = await api('/api/admin/settings/test-sms', {
        method: 'POST',
        body: JSON.stringify({ phone })
      });
      toast(`测试短信已提交（${result.provider}），请查收`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '发送测试';
    }
  });

  $('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const oldPassword = $('pwdOld').value;
    const newPassword = $('pwdNew').value;
    const confirmPassword = $('pwdConfirm').value;
    if (newPassword !== confirmPassword) {
      toast('两次输入的新密码不一致', true);
      return;
    }
    try {
      await api('/api/admin/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ oldPassword, newPassword })
      });
      toast('密码已修改');
      $('passwordForm').reset();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ---------------- 留资筛选 ---------------- */
  $('leadSearchBtn').addEventListener('click', () => {
    state.leads.filters = {
      campaignId: $('leadCampaign').value,
      from: $('leadFrom').value,
      to: $('leadTo').value,
      keyword: $('leadKeyword').value.trim()
    };
    loadLeads(true);
  });

  $('leadResetBtn').addEventListener('click', () => {
    $('leadCampaign').value = '';
    $('leadFrom').value = '';
    $('leadTo').value = '';
    $('leadKeyword').value = '';
    state.leads.filters = { campaignId: '', from: '', to: '', keyword: '' };
    loadLeads(true);
  });

  $('leadKeyword').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('leadSearchBtn').click();
  });

  async function fillCampaignFilter() {
    try {
      const data = await api('/api/admin/campaigns');
      state.campaigns = data.list;
      const select = $('leadCampaign');
      select.innerHTML =
        '<option value="">全部活动</option>' +
        data.list.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    } catch (_) {
      /* ignore */
    }
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(html, wide) {
    $('modalBox').innerHTML = html;
    $('modalBox').classList.toggle('wide', !!wide);
    $('modalMask').classList.remove('hidden');
  }

  function closeModal() {
    $('modalMask').classList.add('hidden');
    $('modalBox').innerHTML = '';
    $('modalBox').classList.remove('wide');
  }

  $('modalMask').addEventListener('click', (event) => {
    if (event.target === $('modalMask')) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  /* ---------------- 启动 ---------------- */
  (async function init() {
    try {
      const me = await api('/api/admin/auth/me');
      state.admin = me;
      showApp();
      await fillCampaignFilter();
      go(location.hash.replace('#/', '') || 'dashboard');
    } catch (_) {
      showLogin();
    }
  })();
})();
