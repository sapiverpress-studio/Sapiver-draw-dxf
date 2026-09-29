import { inferDimensionIntent } from './core/analysis-integrity.js';

let pendingMode = null;
let pendingSourceText = '';

function buttonFromEvent(event) {
  const target = event.target;
  return target instanceof Element ? target.closest('button') : null;
}

function optionCompatible(intent, label) {
  const text = String(label || '').toLowerCase();
  if (!intent || intent === 'unknown') return true;
  if (text.includes('additional reference')) return true;
  if (intent === 'radius') return /radius/.test(text);
  if (intent === 'diameter') return /diameter/.test(text);
  if (intent === 'position') return /position|\bx\b|\by\b|offset/.test(text);
  if (intent === 'width') return /width|chord|span/.test(text);
  if (intent === 'height') return /height|rise|sagitta/.test(text);
  if (intent === 'depth') return /depth/.test(text);
  if (intent === 'offset') return /offset|position/.test(text);
  if (intent === 'chord') return /chord|span|width/.test(text);
  if (intent === 'rise') return /rise|sagitta|height/.test(text);
  if (intent === 'length') return /length|width|height|side|segment|shoulder|chord|rise|depth/.test(text);
  return true;
}

function ensureMessage(dialog) {
  let message = dialog.querySelector('#dimensionAssignmentGuardMessage');
  if (message) return message;
  message = document.createElement('p');
  message.id = 'dimensionAssignmentGuardMessage';
  message.className = 'helper';
  const actions = dialog.querySelector('.dialog-actions');
  actions?.before(message);
  return message;
}

function deactivateGuard() {
  const dialog = document.querySelector('#dimensionDialog');
  if (!dialog) return;
  dialog.dataset.assignmentGuardActive = 'false';
  const message = dialog.querySelector('#dimensionAssignmentGuardMessage');
  if (message) message.textContent = '';
}

function hardenOpenDialog() {
  const dialog = document.querySelector('#dimensionDialog');
  if (!dialog?.open || !pendingMode) return;
  const select = dialog.querySelector('#dimensionTarget');
  const addButton = dialog.querySelector('#dimensionAddBtn');
  if (!(select instanceof HTMLSelectElement) || !(addButton instanceof HTMLButtonElement)) return;

  dialog.dataset.assignmentGuardActive = 'true';
  const intent = pendingMode === 'assign' ? inferDimensionIntent(pendingSourceText) : 'unknown';

  let placeholder = [...select.options].find((option) => option.dataset.assignmentGuardPlaceholder === 'true');
  if (!placeholder) {
    placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = pendingMode === 'assign' ? 'Choose the correct production parameter…' : 'Choose what this dimension controls…';
    placeholder.disabled = true;
    placeholder.dataset.assignmentGuardPlaceholder = 'true';
    select.prepend(placeholder);
  }
  placeholder.selected = true;
  select.value = '';

  for (const option of [...select.options]) {
    if (option === placeholder) continue;
    option.disabled = pendingMode === 'assign' && !optionCompatible(intent, option.textContent);
  }

  const message = ensureMessage(dialog);
  message.textContent = pendingMode === 'assign'
    ? (intent === 'unknown'
      ? 'Choose the production parameter this figured value actually controls. Nothing is selected automatically.'
      : `This read appears to be a ${intent} value. Incompatible production parameters are disabled; nothing is selected automatically.`)
    : 'Choose the production parameter explicitly. The app will not guess a target for a manually added dimension.';
  addButton.disabled = true;

  if (select.dataset.assignmentGuardBound !== 'true') {
    select.dataset.assignmentGuardBound = 'true';
    select.addEventListener('change', () => {
      if (dialog.dataset.assignmentGuardActive !== 'true') return;
      const selected = select.selectedOptions[0];
      const activeIntent = inferDimensionIntent(dialog.dataset.assignmentGuardSource || '');
      const compatible = Boolean(select.value) && selected && !selected.disabled && optionCompatible(activeIntent, selected.textContent);
      addButton.disabled = !compatible;
      if (!compatible && select.value) message.textContent = 'That figured value does not match the selected production parameter. Choose the correct target.';
    });
  }

  if (addButton.dataset.assignmentGuardBound !== 'true') {
    addButton.dataset.assignmentGuardBound = 'true';
    addButton.addEventListener('click', (event) => {
      if (dialog.dataset.assignmentGuardActive !== 'true') return;
      const selected = select.selectedOptions[0];
      const activeIntent = inferDimensionIntent(dialog.dataset.assignmentGuardSource || '');
      if (!select.value || !selected || selected.disabled || !optionCompatible(activeIntent, selected.textContent)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        message.textContent = 'Select a compatible production parameter before adding this dimension.';
        select.focus();
      }
    }, true);
  }

  dialog.dataset.assignmentGuardSource = pendingMode === 'assign' ? pendingSourceText : '';
  pendingMode = null;
  pendingSourceText = '';
}

function afterLegacyDialogSetup(callback) {
  window.setTimeout(callback, 0);
}

document.addEventListener('click', (event) => {
  const button = buttonFromEvent(event);
  if (!button) return;

  if (button.id === 'addCorrectionBtn') {
    pendingMode = 'new';
    pendingSourceText = '';
    afterLegacyDialogSetup(hardenOpenDialog);
    return;
  }

  if (button.textContent?.trim() === 'Assign' && button.closest('.unlinked-read')) {
    pendingMode = 'assign';
    pendingSourceText = button.closest('.unlinked-read')?.textContent || '';
    afterLegacyDialogSetup(hardenOpenDialog);
    return;
  }

  if (button.textContent?.trim() === 'Add value') {
    pendingMode = null;
    pendingSourceText = '';
    afterLegacyDialogSetup(deactivateGuard);
  }
}, true);

document.addEventListener('close', (event) => {
  if (event.target instanceof HTMLDialogElement && event.target.id === 'dimensionDialog') deactivateGuard();
}, true);
