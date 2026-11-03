// Guided review is a presentation layer over the existing, safety-checked review model.
// The original measurement cards and their validation/approval handlers remain authoritative.
const list = document.querySelector('#dimensionList');
const side = list?.parentElement;
const previewStack = document.querySelector('.preview-stack');

if (list && side && previewStack) {
  const state = {
    sourceTitle: '',
    selectedKey: null,
    editingKey: null,
    advanceKey: null,
    extrasOpen: true,
  };

  const header = document.createElement('section');
  header.id = 'guidedReview';
  header.className = 'guided-review-header';
  header.setAttribute('aria-label', 'Guided dimension review');
  header.hidden = true;
  header.innerHTML = [
    '<div class="guided-heading"><strong id="guidedFeatureName"></strong><span id="guidedStepCounter"></span></div>',
    '<div class="guided-progress" role="progressbar" aria-label="Measurements confirmed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="guidedProgressFill"></span></div>',
    '<div class="guided-task"><strong id="guidedTaskName"></strong><span id="guidedTaskStatus"></span></div>',
    '<p class="guided-hint" id="guidedHint">Check this measurement against the original drawing.</p>',
  ].join('');
  list.before(header);

  const footer = document.createElement('div');
  footer.id = 'guidedReviewFooter';
  footer.className = 'guided-review-footer';
  footer.hidden = true;
  footer.innerHTML = [
    '<div class="guided-navigation">',
    '<button type="button" id="guidedPrevious" class="button quiet">Previous</button>',
    '<button type="button" id="guidedSkip" class="button quiet">Skip for now</button>',
    '<button type="button" id="guidedNext" class="button quiet">Next</button>',
    '</div>',
    '<button type="button" id="guidedExtraToggle" class="button quiet full" hidden aria-expanded="false"></button>',
  ].join('');
  list.after(footer);

  const originalPane = [...previewStack.children].find((child) => child.querySelector('#drawingPreview'));
  const digitalPane = [...previewStack.children].find((child) => child.querySelector('#geometryPreview'));
  if (originalPane && digitalPane) {
    originalPane.dataset.previewPane = 'original';
    digitalPane.dataset.previewPane = 'dxf';
    const tabs = document.createElement('div');
    tabs.className = 'guided-preview-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Drawing view');
    tabs.innerHTML = [
      '<button class="guided-preview-tab" type="button" role="tab" data-preview-choice="original" aria-selected="false">Original</button>',
      '<button class="guided-preview-tab" type="button" role="tab" data-preview-choice="dxf" aria-selected="true">DXF preview</button>',
    ].join('');
    previewStack.prepend(tabs);
    function setPreview(name) {
      previewStack.dataset.activePreview = name;
      tabs.querySelectorAll('[data-preview-choice]').forEach((button) => {
        const selected = button.dataset.previewChoice === name;
        button.setAttribute('aria-selected', String(selected));
        button.classList.toggle('active', selected);
      });
    }
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-preview-choice]');
      if (button) setPreview(button.dataset.previewChoice);
    });
    setPreview('dxf');
  }

  const ui = {
    feature: header.querySelector('#guidedFeatureName'),
    counter: header.querySelector('#guidedStepCounter'),
    fill: header.querySelector('#guidedProgressFill'),
    bar: header.querySelector('.guided-progress'),
    task: header.querySelector('#guidedTaskName'),
    status: header.querySelector('#guidedTaskStatus'),
    hint: header.querySelector('#guidedHint'),
    previous: footer.querySelector('#guidedPrevious'),
    next: footer.querySelector('#guidedNext'),
    skip: footer.querySelector('#guidedSkip'),
    extras: footer.querySelector('#guidedExtraToggle'),
  };

  function getSteps() {
    const steps = [];
    const occurrences = new Map();
    for (const group of list.querySelectorAll(':scope > .feature-group:not(.auxiliary-group)')) {
      const groupTitle = group.querySelector('.feature-group-head strong')?.textContent.trim() || 'Glass feature';
      for (const card of group.querySelectorAll(':scope > .feature-dimension')) {
        const label = card.querySelector('.dimension-title-row strong')?.textContent.trim() || 'Measurement';
        const baseKey = groupTitle + ' / ' + label;
        const number = (occurrences.get(baseKey) || 0) + 1;
        occurrences.set(baseKey, number);
        const isProcess = !!card.querySelector('.parameter-pill.process');
        steps.push({
          key: baseKey + ' / ' + number,
          group,
          groupTitle,
          card,
          label,
          isProcess,
          slotKey: card.dataset.slotKey || '',
          isPerimeter: group.dataset.reviewGroup === 'perimeter',
          confirmed: card.classList.contains('is-confirmed'),
        });
      }
    }

    // Keep manufacturing finish beside the rest of its cut-out's measurements.
    const ordinary = steps.filter((step) => !step.isProcess);
    for (const process of steps.filter((step) => step.isProcess)) {
      const target = process.label.replace(/\s+edge finish$/i, '').toLowerCase();
      let after = -1;
      for (let i = 0; i < ordinary.length; i += 1) {
        const name = ordinary[i].groupTitle.toLowerCase();
        if (name === target || name.includes(target) || target.includes(name)) after = i;
      }
      if (after >= 0) ordinary.splice(after + 1, 0, process);
      else ordinary.push(process);
    }
    return ordinary;
  }

  function nextIndex(steps, index, onlyPending = false) {
    for (let i = index + 1; i < steps.length; i += 1) {
      if (!onlyPending || !steps[i].confirmed) return i;
    }
    return -1;
  }

  function scrollToReview() {
    header.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  function navigate(offset) {
    const steps = getSteps();
    const current = steps.findIndex((step) => step.key === state.selectedKey);
    const index = current + offset;
    if (index < 0 || index >= steps.length) return;
    state.selectedKey = steps[index].key;
    state.editingKey = null;
    apply();
    scrollToReview();
  }

  function apply() {
    const steps = getSteps();
    const title = document.querySelector('#activeSourceTitle')?.textContent.trim() || '';
    if (state.sourceTitle !== title) {
      state.sourceTitle = title;
      state.selectedKey = null;
      state.editingKey = null;
      state.advanceKey = null;
      state.extrasOpen = true;
    }

    const enabled = steps.length > 0;
    side.classList.toggle('guided-enabled', enabled);
    side.closest('.review-panel')?.classList.toggle('guided-review-enabled', enabled);
    header.hidden = !enabled;
    footer.hidden = !enabled;
    if (!enabled) return;

    let index = steps.findIndex((step) => step.key === state.selectedKey);
    if (state.advanceKey) {
      const previouslyConfirmed = steps.find((step) => step.key === state.advanceKey);
      if (previouslyConfirmed?.confirmed) {
        const previousIndex = steps.indexOf(previouslyConfirmed);
        const next = nextIndex(steps, previousIndex, true);
        index = next >= 0 ? next : steps.findIndex((step) => !step.confirmed);
        if (index < 0) index = previousIndex;
      }
      state.advanceKey = null;
    }
    if (index < 0) index = steps.findIndex((step) => !step.confirmed);
    if (index < 0) index = 0;
    const active = steps[index];
    if (state.selectedKey !== active.key) state.editingKey = null;
    state.selectedKey = active.key;

    for (const group of list.querySelectorAll(':scope > .feature-group:not(.auxiliary-group)')) {
      group.classList.toggle('guided-current-group', group === active.group);
    }
    for (const step of steps) {
      step.card.classList.toggle('guided-current-step', step === active);
    }

    const done = steps.filter((step) => step.confirmed).length;
    ui.feature.textContent = active.isPerimeter ? 'Outer glass' :
      active.isProcess ? active.label.replace(/\s+edge finish$/i, '') : active.groupTitle;
    ui.counter.textContent = 'Review ' + (index + 1) + ' of ' + steps.length + ' · ' + done + ' confirmed';
    ui.task.textContent = active.confirmed ? active.label + ' — confirmed' : 'Confirm ' + active.label;
    ui.status.textContent = active.confirmed ? 'Confirmed' : 'Pending';
    ui.status.classList.toggle('complete', active.confirmed);
    ui.fill.style.width = (100 * done / steps.length) + '%';
    ui.bar.setAttribute('aria-valuenow', String(Math.round(100 * done / steps.length)));
    const svg = document.querySelector('#geometryPreview svg');
    let highlightFound = false;
    if (svg) {
      for (const segment of svg.querySelectorAll('[data-slot-key]')) {
        const isSelected = Boolean(active.slotKey && segment.getAttribute('data-slot-key') === active.slotKey);
        segment.classList.toggle('is-active-dimension', isSelected);
        if (isSelected) highlightFound = true;
      }
    }
    ui.hint.textContent = active.isProcess
      ? 'Confirm the actual workshop finish for this cut-out.'
      : highlightFound
        ? 'Amber highlights the current measurement on the digital drawing. Check it against the original.'
        : 'Check this measurement against the original. Its precise drawing highlight may require other dimensions to be confirmed.';

    ui.previous.disabled = index === 0;
    ui.next.disabled = index === steps.length - 1;
    ui.skip.hidden = active.confirmed || index === steps.length - 1;
    ui.next.textContent = index === steps.length - 1 ? 'End of review' : 'Next';

    const editMode = state.editingKey === active.key;
    active.card.classList.toggle('guided-editing', editMode);
    const input = active.card.querySelector('.dimension-value-wrap input');
    if (input) input.readOnly = !editMode;

    const position = active.card.querySelector('.position-controls');
    const reference = active.card.querySelector('.guided-position-summary') || document.createElement('p');
    if (position && !reference.isConnected) {
      reference.className = 'guided-position-summary';
      position.after(reference);
    }
    if (position) {
      const selectors = [...position.querySelectorAll('select')];
      const ref = selectors[0];
      const edge = selectors[1];
      const unknown = !ref || ref.value === 'unknown' ||
        (ref.value !== 'previous' && (!edge || edge.value === 'unknown'));
      reference.textContent = unknown
        ? 'Position reference missing — select Edit to specify the measuring edges.'
        : ref.value === 'previous'
          ? 'Measured from the previous cut-out.'
          : 'From the ' + edge.value + ' glass edge to the feature ' +
            (ref.value === 'centre' ? 'centre.' : edge.value + ' edge.');
      active.card.classList.toggle('guided-reference-missing', unknown);
    } else {
      active.card.classList.remove('guided-reference-missing');
    }

    if (input) {
      let edit = active.card.querySelector('.guided-edit-button');
      if (!edit) {
        edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'button quiet guided-edit-button';
        edit.textContent = 'Edit';
        active.card.querySelector('.dimension-card-actions')?.appendChild(edit);
        edit.addEventListener('click', () => {
          state.editingKey = active.key;
          apply();
          const field = active.card.querySelector('.dimension-value-wrap input');
          field?.focus();
          field?.select();
        });
      }
      edit.disabled = editMode;
      edit.textContent = editMode ? 'Editing' : 'Edit';
    }
    const confirm = active.card.querySelector('.dimension-confirm');
    if (confirm && position && active.card.classList.contains('guided-reference-missing')) {
      confirm.disabled = true;
    }
    if (confirm && !active.card.classList.contains('guided-reference-missing') && !active.confirmed) {
      confirm.disabled = false;
    }

    const extras = [...list.querySelectorAll(':scope > .auxiliary-group:not(.analysis-questions)')];
    const hasExtras = extras.length > 0;
    ui.extras.hidden = !hasExtras;
    ui.extras.textContent = (state.extrasOpen ? 'Hide' : 'Review') + ' additional AI readings (' +
      extras.reduce((total, group) => total + group.querySelectorAll('.unlinked-read').length, 0) + ')';
    ui.extras.setAttribute('aria-expanded', String(state.extrasOpen));
    side.classList.toggle('guided-extras-open', state.extrasOpen);
  }

  ui.previous.addEventListener('click', () => navigate(-1));
  ui.next.addEventListener('click', () => navigate(1));
  ui.skip.addEventListener('click', () => navigate(1));
  ui.extras.addEventListener('click', () => {
    state.extrasOpen = !state.extrasOpen;
    apply();
  });

  // The existing confirm handler updates the real review model and redraws the list.
  // Advance only when that new model actually reports this dimension confirmed.
  list.addEventListener('click', (event) => {
    const confirm = event.target.closest('.guided-current-step .dimension-confirm');
    if (confirm && !confirm.disabled) state.advanceKey = state.selectedKey;
  }, true);
  list.addEventListener('change', () => requestAnimationFrame(apply));
  let scheduled = false;
  const observer = new MutationObserver((records) => {
    if (!records.some((record) => record.target === list && record.type === 'childList')) return;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  });
  observer.observe(list, { childList: true });
  const drawing = document.querySelector('#geometryPreview');
  if (drawing) {
    let painting = false;
    new MutationObserver(() => {
      if (painting) return;
      painting = true;
      requestAnimationFrame(() => { painting = false; apply(); });
    }).observe(drawing, { childList: true, subtree: true });
  }
  apply();
}
