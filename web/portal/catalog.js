window.createLayoutCatalog = ({apps, groups, link, escape}) => {
  const dialog = document.createElement('dialog');
  dialog.className = 'layout-catalog';
  dialog.setAttribute('aria-label', '应用目录');
  const listId = `catalog-results-${document.querySelectorAll('.layout-catalog').length}`;
  dialog.innerHTML = `
    <div class="layout-catalog-head">
      <input type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${listId}" placeholder="Search apps" aria-label="搜索应用" autocomplete="off" spellcheck="false">
      <button class="layout-catalog-close" type="button" aria-label="关闭应用目录">×</button>
    </div>
    <div class="layout-catalog-filters" aria-label="应用分类">
      ${Object.entries({all:'All', ...groups}).map(([key, name]) => `<button type="button" data-filter="${escape(key)}" aria-pressed="false">${escape(name)}</button>`).join('')}
      <kbd class="layout-catalog-tab-hint" aria-label="Tab 切换分类，Shift+Tab 反向切换" title="Tab / Shift+Tab">⇥</kbd>
    </div>
    <ul class="layout-catalog-list" id="${listId}" role="listbox" aria-label="应用"></ul>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('ul');
  const filters = [...dialog.querySelectorAll('[data-filter]')];
  let group = 'all';
  let composing = false;
  let results = [];
  let selectedIndex = -1;
  const normalize = value => value.normalize('NFKC').trim().toLowerCase();
  function select(index, scroll = false) {
    selectedIndex = index;
    results.forEach((anchor, i) => anchor.setAttribute('aria-selected', String(i === index)));
    const selected = results[index];
    if (selected) {
      input.setAttribute('aria-activedescendant', selected.id);
      if (scroll) selected.scrollIntoView({block:'nearest', inline:'nearest'});
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
  function render() {
    const query = normalize(input.value);
    const matches = apps.filter(app => (group === 'all' || group === app.group) &&
      normalize(`${app.name} ${app.aliases ?? ''} ${groups[app.group]}`).includes(query));
    list.innerHTML = matches.length ? matches.map(app => `<li role="none">${link(app,
      `<span>${escape(app.name)}${app.test ? '<small>TEST</small>' : ''}</span>`,
      'layout-catalog-link')}</li>`).join('') : '<li class="layout-catalog-empty" role="presentation">没有找到应用</li>';
    results = [...list.querySelectorAll('a')];
    results.forEach((anchor, index) => {
      anchor.id = `${listId}-${index}`;
      anchor.setAttribute('role', 'option');
      anchor.tabIndex = -1;
    });
    select(results.length ? 0 : -1);
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === group)));
    dialog.scrollTop = 0;
  }
  function changeGroup(next) {
    group = next;
    render();
    input.focus({preventScroll:true});
  }
  input.addEventListener('input', render);
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; render(); });
  dialog.addEventListener('cancel', event => { if (composing) event.preventDefault(); });
  function finishClose() {
    if (dialog.open) return;
    composing = false;
    input.setAttribute('aria-expanded', 'false');
    // Closing from an unfocusable homepage area can leave focus in the hidden input.
    if (dialog.contains(document.activeElement)) document.activeElement.blur();
  }
  function close() {
    dialog.close();
    finishClose();
  }
  dialog.addEventListener('close', finishClose);
  dialog.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      const current = filters.findIndex(button => button.dataset.filter === group);
      const next = (current + (event.shiftKey ? -1 : 1) + filters.length) % filters.length;
      changeGroup(filters[next].dataset.filter);
    } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      if (!results.length) return;
      const columns = getComputedStyle(list).gridTemplateColumns.split(' ').length;
      const column = selectedIndex % columns;
      let next = selectedIndex;
      if (event.key === 'ArrowLeft' && column > 0) next--;
      if (event.key === 'ArrowRight' && column < columns - 1) next = Math.min(next + 1, results.length - 1);
      if (event.key === 'ArrowUp' && next >= columns) next -= columns;
      if (event.key === 'ArrowDown' && next - column + columns < results.length) next = Math.min(next + columns, results.length - 1);
      select(next, true);
      input.focus({preventScroll:true});
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      if (!event.repeat) results[selectedIndex]?.click();
    }
  });
  list.addEventListener('focusin', event => {
    const index = results.indexOf(event.target);
    if (index >= 0) select(index);
  });
  dialog.querySelector('.layout-catalog-close').addEventListener('click', close);
  filters.forEach(button => button.addEventListener('click', () => changeGroup(button.dataset.filter)));
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  const open = (next = 'all', query = '') => {
    group = Object.hasOwn(groups, next) ? next : 'all';
    input.value = query;
    render();
    if (!dialog.open) dialog.showModal();
    input.setAttribute('aria-expanded', 'true');
    dialog.scrollTop = 0;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  return {open, dialog};
};
