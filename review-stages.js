const list = document.querySelector('#dimensionList');
const progress = document.querySelector('#reviewProgress');

if (list && progress) {
  let scheduled = false;

  function cardConfirmed(card) {
    return card.classList.contains('is-confirmed');
  }

  function isPerimeterGroup(group) {
    if (group.dataset.reviewGroup) return group.dataset.reviewGroup === 'perimeter';
    const labels = [...group.querySelectorAll('.feature-dimension .dimension-title-row strong')].map((el) => el.textContent.trim().toLowerCase());
    return labels.length > 0 && labels.every((label) => label.startsWith('overall '));
  }

  function makeHeader(stage, title, detail, complete) {
    const el = document.createElement('div');
    el.className = `review-stage-head ${complete ? 'complete' : ''}`;
    el.dataset.reviewStage = stage;
    el.innerHTML = `<span><strong>${title}</strong><small>${detail}</small></span><em>${complete ? 'Complete ✓' : 'In progress'}</em>`;
    return el;
  }

  function applyStages() {
    scheduled = false;
    const oldHeaders = [...list.querySelectorAll(':scope > .review-stage-head')];
    oldHeaders.forEach((el) => el.remove());

    const groups = [...list.querySelectorAll(':scope > .feature-group:not(.auxiliary-group)')];
    if (!groups.length) return;

    const perimeterGroups = groups.filter(isPerimeterGroup);
    const featureGroups = groups.filter((group) => !isPerimeterGroup(group));
    const perimeterCards = perimeterGroups.flatMap((group) => [...group.querySelectorAll('.feature-dimension')]);
    const perimeterConfirmed = perimeterCards.filter(cardConfirmed).length;
    const perimeterTotal = perimeterCards.length;
    const perimeterComplete = perimeterTotal > 0 && perimeterConfirmed === perimeterTotal;

    if (perimeterGroups[0]) {
      list.insertBefore(
        makeHeader('perimeter', '1 · Confirm perimeter', `${perimeterConfirmed}/${perimeterTotal} perimeter measurements confirmed`, perimeterComplete),
        perimeterGroups[0],
      );
    }

    // Keep detected features visible throughout review. Release remains guarded
    // by confirmation state, but hiding evidence made successful detections look
    // like analyser failures and prevented operators spotting association errors.
    featureGroups.forEach((group) => { group.hidden = false; });

    if (featureGroups.length) {
      const featureCards = featureGroups.flatMap((group) => [...group.querySelectorAll('.feature-dimension')]);
      const featureConfirmed = featureCards.filter(cardConfirmed).length;
      const featureTotal = featureCards.length;
      const featureComplete = featureTotal > 0 && featureConfirmed === featureTotal;
      const header = makeHeader(
        'features',
        '2 · Add cut-outs / holes',
        `${featureConfirmed}/${featureTotal} feature measurements confirmed${perimeterComplete ? '' : ' · finish perimeter confirmation before release'}`,
        perimeterComplete && featureComplete,
      );
      const anchor = featureGroups[0];
      list.insertBefore(header, anchor);
      header.classList.toggle('locked-stage', false);
    }

    const totalCards = groups.flatMap((group) => [...group.querySelectorAll('.feature-dimension')]);
    const totalConfirmed = totalCards.filter(cardConfirmed).length;
    if (!perimeterComplete) progress.textContent = `Perimeter ${perimeterConfirmed} / ${perimeterTotal}`;
    else progress.textContent = `${totalConfirmed} / ${totalCards.length} confirmed`;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyStages);
  }

  const observer = new MutationObserver((records) => {
    if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 && !node.classList?.contains('review-stage-head')))) schedule();
  });
  observer.observe(list, { childList: true });
  window.addEventListener('load', schedule, { once: true });
  schedule();
}
