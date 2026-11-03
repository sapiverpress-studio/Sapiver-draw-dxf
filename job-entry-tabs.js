// New job / Saved job selection. The established application remains responsible
// for creating, loading and validating jobs; this module changes navigation only.
const newMode = document.querySelector('#jobModeNew');
const savedMode = document.querySelector('#jobModeSaved');
const newPanel = document.querySelector('#newJobWorkspace');
const savedPanel = document.querySelector('#savedJobWorkspace');
const legacyNewButton = document.querySelector('#newJobBtn');
const legacyRefreshButton = document.querySelector('#refreshJobsBtn');
const jobResults = document.querySelector('#jobResults');
const saveState = document.querySelector('#saveState');

if (newMode && savedMode && newPanel && savedPanel && legacyNewButton && legacyRefreshButton) {
  function show(mode) {
    const isNew = mode === 'new';
    newPanel.hidden = !isNew;
    savedPanel.hidden = isNew;
    newMode.classList.toggle('selected', isNew);
    savedMode.classList.toggle('selected', !isNew);
    newMode.setAttribute('aria-pressed', String(isNew));
    savedMode.setAttribute('aria-pressed', String(!isNew));
  }

  newMode.addEventListener('click', () => {
    // Preserve the original unsaved-job warning and state-clearing logic.
    legacyNewButton.click();
    show('new');
    document.querySelector('#jobRef')?.focus();
  });

  savedMode.addEventListener('click', () => {
    show('saved');
    legacyRefreshButton.click();
    document.querySelector('#jobSearch')?.focus();
  });

  // The original async load implementation writes this status only after a
  // job has been hydrated. Do not switch on a failed load.
  if (saveState && jobResults) {
    const observer = new MutationObserver(() => {
      if (!savedPanel.hidden && /^Loaded shared job\b/.test(saveState.textContent.trim())) {
        show('new');
      }
    });
    observer.observe(saveState, { childList: true, characterData: true, subtree: true });
  }
}
