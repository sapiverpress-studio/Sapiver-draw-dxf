const CACHE_KEY = 'quick-dxf-unsynced-v1';

function getCachedJob() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}

function setReleaseMessage(text, mode = '') {
  const el = document.querySelector('#releaseMessage');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', mode === 'error');
}

function normaliseMime(name, type) {
  if (/\.dxf$/i.test(name)) return 'text/plain';
  if (type) return type;
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'application/octet-stream';
}

async function fileFromRef(ref) {
  if (!ref?.url || !ref?.name) throw new Error('A release file is missing its stored reference.');
  const response = await fetch(ref.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not retrieve ${ref.name} (${response.status}).`);
  const blob = await response.blob();
  return new File([blob], ref.name, { type: normaliseMime(ref.name, blob.type) });
}

export function releaseRefs(job) {
  if (!job) return [];
  const refs = [];
  if (job.confirmationPdf) refs.push(job.confirmationPdf);
  if (job.outcome === 'production' && job.signedProof) refs.push(job.signedProof);
  refs.push(...(Array.isArray(job.dxfFiles) ? job.dxfFiles : []));
  return refs;
}

function downloadFiles(files) {
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

export async function shareCurrentJob() {
  const job = getCachedJob();
  if (!job || job.status !== 'locked' || !Array.isArray(job.dxfFiles) || !job.dxfFiles.length) {
    throw new Error('The signed revision must be locked and have DXF output before it can be shared.');
  }

  const refs = releaseRefs(job);
  if (!refs.length) throw new Error('No release files are available.');
  const files = [];
  for (const ref of refs) files.push(await fileFromRef(ref));

  const jobRef = String(job.jobRef || job.id || 'Quick DXF');
  const shareData = {
    title: `Quick DXF ${jobRef} · Rev ${job.revision || 1}`,
    text: job.outcome === 'production'
      ? `Approved Quick DXF production pack for ${jobRef}, revision ${job.revision || 1}.`
      : `Confirmed DXF files for ${jobRef}, revision ${job.revision || 1}.`,
    files,
  };

  if (navigator.share && (!navigator.canShare || navigator.canShare({ files }))) {
    await navigator.share(shareData);
    return { mode: 'share', fileCount: files.length };
  }

  downloadFiles(files);
  return { mode: 'download', fileCount: files.length };
}

function removeLegacyEmailLanguage() {
  const button = document.querySelector('#sendBtn');
  const buttonText = button?.textContent?.trim();
  if (button && buttonText !== 'Sharing…' && buttonText !== 'Share job pack') {
    button.textContent = 'Share job pack';
  }
  const message = document.querySelector('#releaseMessage');
  if (message?.textContent.includes('Confirm the recipient and email the release pack.')) {
    message.textContent = 'Revision locked. Share the release pack to email, Drive or another destination on this device.';
  }
}

function installBrowserShareHandler() {
  const observer = new MutationObserver(removeLegacyEmailLanguage);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  removeLegacyEmailLanguage();

  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('#sendBtn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled) return;

    button.disabled = true;
    button.textContent = 'Sharing…';
    setReleaseMessage('Preparing the confirmed release files…');
    try {
      const result = await shareCurrentJob();
      setReleaseMessage(result.mode === 'share'
        ? `Share sheet opened with ${result.fileCount} release file${result.fileCount === 1 ? '' : 's'}. The revision remains locked in Quick DXF.`
        : `This browser cannot share these files directly. ${result.fileCount} release file${result.fileCount === 1 ? '' : 's'} downloaded instead.`);
    } catch (error) {
      if (error?.name === 'AbortError') setReleaseMessage('Share cancelled. The locked revision is unchanged.');
      else setReleaseMessage(`Share failed: ${error?.message || error}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Share job pack';
    }
  }, true);
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') installBrowserShareHandler();
