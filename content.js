(() => {
  'use strict';

  if (window.top !== window || window.__doubaoBatchDeleteLoaded) return;
  window.__doubaoBatchDeleteLoaded = true;

  const STATE = {
    selected: new Set(),
    rows: new Map(),
    running: false,
    stopped: false,
    observer: null,
    scanTimer: 0,
  };

  const TEXT = {
    delete: /^删除(?:对话|会话)?$/,
    confirmDelete: /^(?:确认)?删除$/,
    cancel: /^(?:取消|暂不)$/,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
  };
  const normalizedText = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const clickable = (el) => el?.closest('button,[role="button"],[role="menuitem"],a,[tabindex]') || el;

  function toast(message, type = 'info') {
    let el = document.getElementById('dbbd-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dbbd-toast';
      document.body.appendChild(el);
    }
    el.dataset.type = type;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function sidebar() {
    return document.querySelector('#flow_chat_sidebar') || document.querySelector('nav');
  }

  function titleFor(row) {
    const titled = [...row.querySelectorAll('[title]')]
      .map((el) => el.getAttribute('title')?.trim())
      .find(Boolean);
    const text = titled || normalizedText(row);
    return text.replace(/Ctrl\s*(?:Shift\s*)?[A-Z]/gi, '').trim().slice(0, 100) || '未命名对话';
  }

  function stableKey(row, index) {
    const link = row.matches('a[href]') ? row : row.querySelector('a[href]');
    const href = link?.getAttribute('href');
    if (href && /\/chat\//.test(href) && !/\/chat\/?$/.test(href)) return `href:${href}`;
    const reactKey = row.getAttribute('data-key') || row.getAttribute('data-id');
    if (reactKey) return `data:${reactKey}`;
    return `text:${titleFor(row)}:${index}`;
  }

  function looksLikeConversation(row) {
    if (!visible(row) || row.closest('#dbbd-panel')) return false;
    const text = titleFor(row);
    if (!text || /^(豆包|新工作任务|新对话|API 服务|更多|定时任务|技能|云盘|手机遥控电脑)$/.test(text)) return false;
    const href = row.querySelector('a[href]')?.getAttribute('href') || row.getAttribute('href') || '';
    if (/\/chat\/[^/?#]+/.test(href)) return true;
    return row.matches('.group\/sidebar_chat_item,[class*="conversation"],[class*="chat-item"],[class*="history-item"]');
  }

  function findRows() {
    const root = sidebar();
    if (!root) return [];
    const selectors = [
      'a[href*="/chat/"]',
      '.group\\/sidebar_chat_item',
      '[class*="conversation-item"]',
      '[class*="chat-item"]',
      '[class*="history-item"]',
    ];
    const raw = [...root.querySelectorAll(selectors.join(','))];
    const rows = raw.map((el) => {
      if (el.matches('a[href*="/chat/"]')) {
        return el.closest('[class*="sidebar_chat"],[class*="conversation"],[class*="chat-item"],[class*="nav-item"]') || el;
      }
      return el;
    }).filter(looksLikeConversation);
    return [...new Set(rows)].filter((row) => !rows.some((other) => other !== row && other.contains(row)));
  }

  function injectCheckbox(row, key) {
    if (row.querySelector(':scope > .dbbd-check')) return;
    row.classList.add('dbbd-row');
    row.dataset.dbbdKey = key;
    const label = document.createElement('label');
    label.className = 'dbbd-check';
    label.title = `选择：${titleFor(row)}`;
    label.innerHTML = '<input type="checkbox" aria-label="选择此对话"><span></span>';
    const input = label.querySelector('input');
    input.checked = STATE.selected.has(key);
    label.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('change', () => {
      input.checked ? STATE.selected.add(key) : STATE.selected.delete(key);
      row.classList.toggle('dbbd-selected', input.checked);
      updatePanel();
    });
    row.prepend(label);
    row.classList.toggle('dbbd-selected', input.checked);
  }

  function scan() {
    if (STATE.running) return;
    STATE.rows.clear();
    findRows().forEach((row, index) => {
      const key = stableKey(row, index);
      STATE.rows.set(key, row);
      injectCheckbox(row, key);
    });
    updatePanel();
  }

  function scheduleScan() {
    clearTimeout(STATE.scanTimer);
    STATE.scanTimer = setTimeout(scan, 160);
  }

  function updatePanel(status) {
    const count = STATE.selected.size;
    const found = STATE.rows.size;
    const countEl = document.getElementById('dbbd-count');
    const statusEl = document.getElementById('dbbd-status');
    const deleteButton = document.getElementById('dbbd-delete');
    if (countEl) countEl.textContent = `已选 ${count} / 已加载 ${found}`;
    if (statusEl && status !== undefined) statusEl.textContent = status;
    if (deleteButton) deleteButton.disabled = STATE.running || count === 0;
  }

  function selectAll(checked) {
    STATE.rows.forEach((row, key) => {
      const input = row.querySelector(':scope > .dbbd-check input');
      if (input) input.checked = checked;
      row.classList.toggle('dbbd-selected', checked);
      checked ? STATE.selected.add(key) : STATE.selected.delete(key);
    });
    updatePanel();
  }

  async function loadMore() {
    const root = sidebar();
    if (!root) return;
    const scrollers = [...root.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 20);
    const scroller = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || root;
    let unchanged = 0;
    let previous = -1;
    for (let i = 0; i < 30 && unchanged < 3; i += 1) {
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(650);
      scan();
      if (STATE.rows.size === previous) unchanged += 1;
      else unchanged = 0;
      previous = STATE.rows.size;
      updatePanel(`正在加载历史记录… ${STATE.rows.size}`);
    }
    updatePanel('加载完成，请检查列表后再选择删除');
  }

  function matchingVisible(regex, scope = document) {
    return [...scope.querySelectorAll('button,[role="button"],[role="menuitem"],li,div,span')]
      .filter((el) => visible(el) && regex.test(normalizedText(el)))
      .sort((a, b) => a.children.length - b.children.length || a.getBoundingClientRect().width - b.getBoundingClientRect().width);
  }

  async function openRowMenu(row) {
    row.scrollIntoView({ block: 'center' });
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(220);
    const candidates = [...row.querySelectorAll('button,[role="button"],[aria-label],[title]')].filter(visible);
    const named = candidates.find((el) => /更多|操作|菜单|more|menu/i.test(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`));
    const iconOnly = candidates.filter((el) => !normalizedText(el)).at(-1);
    const target = named || iconOnly || candidates.at(-1);
    if (!target) throw new Error('找不到该会话的“更多”按钮');
    clickable(target).click();
    await sleep(260);
  }

  async function deleteOne(row) {
    await openRowMenu(row);
    const deleteItem = matchingVisible(TEXT.delete).find((el) => !el.closest('#dbbd-panel'));
    if (!deleteItem) {
      document.body.click();
      throw new Error('菜单中找不到“删除”');
    }
    clickable(deleteItem).click();
    await sleep(300);
    const dialogs = [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"]')].filter(visible);
    const scope = dialogs.at(-1) || document;
    const confirm = matchingVisible(TEXT.confirmDelete, scope)
      .map(clickable)
      .find((el) => visible(el) && !el.closest('#dbbd-panel'));
    if (!confirm) throw new Error('找不到删除确认按钮');
    confirm.click();
    await sleep(700);
  }

  async function runDelete() {
    if (STATE.running || STATE.selected.size === 0) return;
    const chosen = [...STATE.selected].map((key) => ({ key, row: STATE.rows.get(key) })).filter((x) => x.row?.isConnected);
    const names = chosen.slice(0, 8).map((x) => `• ${titleFor(x.row)}`).join('\n');
    const extra = chosen.length > 8 ? `\n…另有 ${chosen.length - 8} 条` : '';
    const phrase = prompt(`将永久删除 ${chosen.length} 条豆包聊天记录，无法恢复：\n\n${names}${extra}\n\n请输入“确认删除”继续：`);
    if (phrase !== '确认删除') {
      toast('已取消，没有删除任何记录');
      return;
    }
    STATE.running = true;
    STATE.stopped = false;
    document.getElementById('dbbd-stop').hidden = false;
    let success = 0;
    const failed = [];
    for (let i = 0; i < chosen.length; i += 1) {
      if (STATE.stopped) break;
      const item = chosen[i];
      updatePanel(`正在删除 ${i + 1}/${chosen.length}：${titleFor(item.row)}`);
      try {
        await deleteOne(item.row);
        STATE.selected.delete(item.key);
        success += 1;
      } catch (error) {
        failed.push(`${titleFor(item.row)}：${error.message}`);
      }
      await sleep(450);
    }
    STATE.running = false;
    document.getElementById('dbbd-stop').hidden = true;
    scheduleScan();
    const summary = `完成：成功 ${success} 条，失败 ${failed.length} 条${STATE.stopped ? '（已停止）' : ''}`;
    updatePanel(summary);
    toast(summary, failed.length ? 'warn' : 'success');
    if (failed.length) console.warn('[豆包批量删除] 失败记录：\n' + failed.join('\n'));
  }

  function createPanel() {
    if (document.getElementById('dbbd-panel')) return;
    const panel = document.createElement('section');
    panel.id = 'dbbd-panel';
    panel.innerHTML = `
      <header><strong>批量管理</strong><button id="dbbd-collapse" title="收起">−</button></header>
      <div class="dbbd-body">
        <div id="dbbd-count">已选 0 / 已加载 0</div>
        <div class="dbbd-actions">
          <button id="dbbd-load">加载全部</button><button id="dbbd-all">全选</button><button id="dbbd-none">清空</button>
        </div>
        <button id="dbbd-delete" class="danger" disabled>删除所选</button>
        <button id="dbbd-stop" hidden>停止任务</button>
        <small id="dbbd-status">删除前会要求输入“确认删除”</small>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector('#dbbd-collapse').addEventListener('click', () => panel.classList.toggle('collapsed'));
    panel.querySelector('#dbbd-load').addEventListener('click', loadMore);
    panel.querySelector('#dbbd-all').addEventListener('click', () => selectAll(true));
    panel.querySelector('#dbbd-none').addEventListener('click', () => selectAll(false));
    panel.querySelector('#dbbd-delete').addEventListener('click', runDelete);
    panel.querySelector('#dbbd-stop').addEventListener('click', () => { STATE.stopped = true; });
  }

  function start() {
    createPanel();
    scan();
    STATE.observer = new MutationObserver(scheduleScan);
    const root = sidebar();
    if (root) STATE.observer.observe(root, { childList: true, subtree: true });
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
})();
