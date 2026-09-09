import { buildStoredZip, saveZip } from './core/zip.js';

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

export function downloadFiles(files) {
  return Promise.all(files.map((file) => file.arrayBuffer())).then((buffers) => {
    const entries = files.map((file, index) => ({ name: file.name, data: new Uint8Array(buffers[index]) }));
    saveZip(buildStoredZip(entries), 'Quick-DXF-release-pack.zip');
  });
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
  const buffers = await Promise.all(files.map((file) => file.arrayBuffer()));
  const zipBytes = buildStoredZip(files.map((file, index) => ({ name: file.name, data: new Uint8Array(buffers[index]) })));
  const safeJobRef = jobRef.replace(/[^A-Za-z0-9_-]+/g, '-');
  const zipFile = new File([zipBytes], `${safeJobRef}-r${job.revision || 1}-release-pack.zip`, { type: 'application/zip' });
  const shareData = {
    title: `Quick DXF ${jobRef} · Rev ${job.revision || 1}`,
    text: job.outcome === 'production'
      ? `Approved Quick DXF production pack for ${jobRef}, revision ${job.revision || 1}.`
      : `Confirmed DXF files for ${jobRef}, revision ${job.revision || 1}.`,
    files: [zipFile],
  };

  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [zipFile] }))) {
    try {
      await navigator.share(shareData);
      return { mode: 'share', fileCount: files.length };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      saveZip(zipBytes, zipFile.name);
      return { mode: 'download-fallback', fileCount: files.length };
    }
  }

  saveZip(zipBytes, zipFile.name);
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
        : `Device sharing was unavailable. ${result.fileCount} release file${result.fileCount === 1 ? '' : 's'} downloaded instead; direct download buttons remain available below.`);
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
