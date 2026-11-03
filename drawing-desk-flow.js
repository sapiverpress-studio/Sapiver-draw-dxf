// Mobile-first pages around the existing production application.
// Does not create jobs, read drawings, call AI or manufacture a DXF itself:
// those remain the responsibility of the existing app-v5 state and API.
const stepNames = {
  start: '1 / 5 · New job or Saved job',
  drawing: '2 / 5 · Take photo, upload PDF or draw manually',
  review: '3 / 5 · Check and edit dimensions',
  approval: '4 / 5 · Customer approval',
  release: '5 / 5 · DXF export',
};
const $ = (selector) => document.querySelector(selector);
const body = document.body;
const sourcePanel = $('.source-panel');
const sourceList = $('#sourceStrip');
const dimensionList = $('#dimensionList');
const saveState = $('#saveState');
const analyse = $('#analyseBtn');
const reviewNext = $('#deskReviewNext');
let awaitingExtraction = false;
let awaitingManual = false;
let selectedSourceKey = '';

function stepTo(page, { focus = true } = {}) {
  if (!stepNames[page]) return;
  body.dataset.deskStep = page;
  $('#deskStepCaption').textContent = stepNames[page];
  for (const error of document.querySelectorAll('.desk-error')) error.hidden = true;
  if (focus) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const panel = page === 'start' ? $('.job-panel')
      : page === 'drawing' ? sourcePanel
      : page === 'review' ? $('.review-panel')
      : page === 'approval' ? $('.approval-panel') : $('.release-panel');
    panel?.setAttribute('tabindex', '-1');
    panel?.focus({ preventScroll: true });
  }
}

function hasReviewData() {
  return Boolean(dimensionList.querySelector('.feature-dimension, .review-only-read'));
}

function reflectData() {
  const sources = [...sourceList.querySelectorAll('.source-card')];
  $('#deskDrawingNext').hidden = !hasReviewData();
  const liveSourceKey = $('.source-card.active')?.textContent?.trim() || '';
  if (selectedSourceKey && selectedSourceKey !== liveSourceKey) {
    awaitingExtraction = false; awaitingManual = false;
  }
  selectedSourceKey = liveSourceKey;
  if (body.dataset.deskStep === 'drawing' && (awaitingExtraction || awaitingManual) && hasReviewData()) {
    awaitingExtraction = false;
    awaitingManual = false;
    stepTo('review');
  }
  if (body.dataset.deskStep === 'drawing' &&
      $('#aiState')?.textContent?.startsWith('Analysis/upload error')) {
    awaitingExtraction = false;
  }
}

function jobDetailsValid() {
  const ref = $('#jobRef'), customer = $('#customerName'), message = $('#deskJobError');
  if (!ref.value.trim() || !customer.value.trim()) {
    message.textContent = 'Enter a job reference and customer name before continuing.';
    message.hidden = false;
    (!ref.value.trim() ? ref : customer).focus();
    return false;
  }
  return true;
}

function showReviewOrDrawingAfterSaved() {
  stepTo(hasReviewData() ? 'review' : 'drawing');
}
function showError(id, text) {
  const element = $(id);
  element.textContent = text;
  element.hidden = false;
}

function initialise() {
  if (!sourcePanel || !dimensionList || !$('#jobModeNew')) return;

  // The original app listens to these same controls, and still owns validation.
  // Rehousing the elements preserves existing event handlers and their state.
  const mount = $('#deskAnalysisMount');
  mount.append($('#manufacturingSettings'), $('.analysis-row'));

  stepTo('start', { focus: false });
  $('#jobModeNew').addEventListener('click', () => {
    awaitingExtraction = false; awaitingManual = false; stepTo('start');
  });
  $('#jobModeSaved').addEventListener('click', () => {
    awaitingExtraction = false; awaitingManual = false; stepTo('start');
  });
  $('#deskNextDrawing').addEventListener('click', () => {
    if (jobDetailsValid()) stepTo('drawing');
  });

  $('#deskDrawingBack').addEventListener('click', () => stepTo('start'));
  $('#deskDrawingNext').addEventListener('click', () => {
    if (hasReviewData()) stepTo('review');
  });
  $('#deskReviewBack').addEventListener('click', () => stepTo('drawing'));
  reviewNext.addEventListener('click', () => {
    if (!hasReviewData() || ($('#pdfBtn').disabled && !$('#pdfState').classList.contains('ok'))) {
      showError('#deskReviewError', 'Confirm the required dimensions and resolve any geometry warnings before customer approval.');
      return;
    }
    stepTo('approval');
  });
  $('#deskApprovalBack').addEventListener('click', () => stepTo('review'));
  $('#deskApprovalNext').addEventListener('click', () => {
    if ($('#productionBtn').disabled && $('#exportChoiceBtn').disabled && !$('#dxfState').classList.contains('ok')) {
      showError('#deskApprovalError', 'Create the confirmation PDF, attach signed approval and tick the customer confirmation box before DXF release.');
      return;
    }
    stepTo('release');
  });
  $('#deskReleaseBack').addEventListener('click', () => stepTo('approval'));
  $('#deskReturnHome').addEventListener('click', () => stepTo('start'));

  // Only an explicit Analyse click transitions into an AI-driven review. Never
  // auto-approve, or advance merely because a file upload has completed.
  analyse.addEventListener('click', () => {
    // The core app marks the button disabled immediately on a valid click,
    // before this listener runs. The click itself proves it was enabled.
    awaitingExtraction = true;
  });
  $('#manualDrawingForm').addEventListener('submit', () => {
    awaitingManual = true;
  });
  $('#manualDrawingDialog').addEventListener('close', () => {
    // Existing manual drawing submission closes only after validation.
    if (awaitingManual && hasReviewData()) {
      awaitingManual = false; stepTo('review');
    }
  });

  if (saveState) {
    new MutationObserver(() => {
      if (/^Loaded shared job\b/.test(saveState.textContent.trim()) &&
          body.dataset.deskStep === 'start') {
        awaitingExtraction = false; awaitingManual = false;
        showReviewOrDrawingAfterSaved();
      }
    }).observe(saveState, { childList: true, characterData: true, subtree: true });
  }

  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      reflectData();
    });
  });
  observer.observe(dimensionList, { childList: true, subtree: true });
  observer.observe(sourceList, { childList: true });
  observer.observe($('#aiState'), { childList: true, subtree: true });
  reflectData();
}
initialise();
