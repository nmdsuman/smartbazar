// Standalone File Manager module to keep admin.js isolated
// Sets a flag so admin.js can skip binding its own File Manager listeners
window.FILE_MANAGER_EXTERNAL = true;

// DOM elements
const fmFile = document.getElementById('fm-file');
const fmPath = document.getElementById('fm-path');
const fmUploadBtn = document.getElementById('fm-upload');
const fmMsg = document.getElementById('fm-msg');
const fmCommitMsg = document.getElementById('fm-message');
const fmFolder = document.getElementById('fm-folder');
const fmFolderRefresh = document.getElementById('fm-folder-refresh');

// Target repo/branch for site files
const SITE_GH_REPO = 'nmdsuman/smartbazar';
const SITE_GH_BRANCH = 'main';

function getGithubTokenFM(){
  try { return localStorage.getItem('GH_TOKEN') || ''; } catch { return ''; }
}
function ensureGithubTokenFM(){
  let t = getGithubTokenFM();
  if (!t) {
    try {
      t = window.prompt('Enter GitHub token for file uploads (stored locally):', '') || '';
      if (t) localStorage.setItem('GH_TOKEN', t);
    } catch {}
  }
  return t;
}

async function fileToBase64FM(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function uploadB64ToGithubRepoFM(b64Content, repo, branch, path, message){
  const token = ensureGithubTokenFM();
  if (!token) throw new Error('GitHub token missing');
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${cleanPath}`;
  // Try to get existing sha (if file exists)
  let sha = undefined;
  try {
    const resHead = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github+json' }
    });
    if (resHead.ok) {
      const info = await resHead.json();
      if (info && typeof info.sha === 'string') sha = info.sha;
    }
  } catch {}
  const body = { message: message || 'Update via admin', content: b64Content, branch };
  if (sha) body.sha = sha;
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error(`GitHub upload failed (${res.status}): ${txt.slice(0,200)}`);
  }
  return `https://raw.githubusercontent.com/${repo}/${branch}/${cleanPath}`;
}

async function loadSiteRepoFoldersFM(){
  if (!fmFolder) return;
  try {
    fmFolder.innerHTML = '';
    const loading = document.createElement('option');
    loading.value = 'loading'; loading.textContent = 'Loading folders...';
    fmFolder.appendChild(loading);
    const token = getGithubTokenFM();
    const apiUrl = `https://api.github.com/repos/${SITE_GH_REPO}/git/trees/${encodeURIComponent(SITE_GH_BRANCH)}?recursive=1`;
    const res = await fetch(apiUrl, { headers: token ? { 'Authorization': `token ${token}` } : {} });
    if (!res.ok) throw new Error('Failed to list repo tree');
    const json = await res.json();
    const dirs = (json?.tree || [])
      .filter(x=>x.type==='tree')
      .map(x=>x.path)
      .filter(Boolean)
      .sort((a,b)=> a.localeCompare(b));
    fmFolder.innerHTML = '';
    const optRoot = document.createElement('option'); optRoot.value = 'main'; optRoot.textContent = 'main (root)'; fmFolder.appendChild(optRoot);
    dirs.forEach(p=>{
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      fmFolder.appendChild(opt);
    });
  } catch (e) {
    fmFolder.innerHTML = '';
    const optRoot = document.createElement('option'); optRoot.value = 'main'; optRoot.textContent = 'main (root)'; fmFolder.appendChild(optRoot);
    if (fmMsg) { fmMsg.textContent = 'Could not load folders. You can still type a path manually.'; fmMsg.className = 'text-sm text-amber-700'; }
  }
}

fmFolderRefresh?.addEventListener('click', (e)=>{
  e.preventDefault();
  try { if (!getGithubTokenFM()) ensureGithubTokenFM(); loadSiteRepoFoldersFM(); } catch {}
});

fmUploadBtn?.addEventListener('click', async ()=>{
  try{
    const file = fmFile?.files?.[0];
    let path = (fmPath?.value || '').trim();
    const message = (fmCommitMsg?.value || 'Update via admin').trim();
    if (!file) { if (fmMsg) { fmMsg.textContent = 'Please choose a file'; fmMsg.className = 'text-sm text-red-700'; } return; }
    const folder = (fmFolder?.value || '').trim();
    let dest = path || (file.name || 'file');
    if (folder && folder !== 'main') {
      dest = `${folder.replace(/^\/+|\/+$/g,'')}/${dest.replace(/^\/+/, '')}`;
    }
    fmUploadBtn.setAttribute('disabled','');
    if (fmMsg) { fmMsg.textContent = 'Uploading to GitHub...'; fmMsg.className = 'text-sm text-gray-700'; }
    const b64 = await fileToBase64FM(file);
    const rawUrl = await uploadB64ToGithubRepoFM(b64, SITE_GH_REPO, SITE_GH_BRANCH, dest, message);
    if (fmMsg) { fmMsg.innerHTML = `Uploaded: <a class="text-blue-700 underline" href="${rawUrl}" target="_blank" rel="noopener">${dest}</a>`; fmMsg.className = 'text-sm text-green-700'; }
    if (fmFile) fmFile.value = '';
    if (fmPath) fmPath.value = '';
  } catch(e){ if (fmMsg) { fmMsg.textContent = 'Upload failed: ' + (e?.message||e); fmMsg.className = 'text-sm text-red-700'; } }
  finally{ fmUploadBtn?.removeAttribute('disabled'); }
});

// Initial load when module runs
try { loadSiteRepoFoldersFM(); } catch {}
