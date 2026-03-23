// background/service-worker.js — Blackboard+ batch PDF downloader

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'DOWNLOAD_FILES') return false;

  downloadAll(msg.files, msg.folder)
    .then(sendResponse)
    .catch(() => sendResponse({ success: 0, failed: msg.files.length }));

  return true; // keep channel open for async response
});

async function downloadAll(files, folder) {
  let success = 0;
  let failed = 0;

  for (const file of files) {
    const path = folder
      ? `${sanitize(folder)}/${sanitize(file.filename)}`
      : sanitize(file.filename);

    try {
      await download(file.url, path);
      success++;
    } catch {
      failed++;
    }

    // throttle to avoid hammering the server
    if (files.length > 1) await sleep(300);
  }

  return { success, failed, total: files.length };
}

function download(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify', saveAs: false },
      (id) => {
        if (chrome.runtime.lastError || !id) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(id);
        }
      }
    );
  });
}

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
