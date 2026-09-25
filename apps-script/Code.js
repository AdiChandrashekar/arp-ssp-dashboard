/**
 * ARP dashboard exporter.
 *
 * Runs inside the Workspace account that can see the "UP SSD Data" Drive folder.
 * For the programme districts it copies each monthly export, removes personal
 * data, and commits a gzipped CSV to the dashboard's GitHub repo, where a
 * GitHub Action rebuilds the dashboard data. Raw files never leave Workspace.
 *
 * One-time setup (Project Settings > Script properties):
 *   GITHUB_TOKEN  fine-grained token: this repo only, Contents read/write
 * Then run setup() once from the editor to create the nightly trigger.
 *
 * Useful functions to run by hand: runExport(), status(), resetState().
 */

const CONFIG = {
  SOURCE_FOLDER_ID: '1o3ClaPV8Sk8Ie2R3tlha8zn5HJr1VKHr', // UP SSD Data
  GITHUB_REPO: 'AdiChandrashekar/arp-ssp-dashboard',
  GITHUB_BRANCH: 'main',
  EXPORT_DIR: 'data/exports',
  // File names (without .xlsx) of the districts in the NIPUN SSP Adoption tracker.
  DISTRICTS: ['AGRA', 'ALIGARH', 'BASTI', 'GHAZIABAD', 'GHAZIPUR', 'GORAKHPUR', 'JHANSI', 'KANPUR_NAGAR', 'MORADABAD', 'SITAPUR'],
  // Stop starting new files after this long; Apps Script kills a run at 6 minutes.
  TIME_BUDGET_MS: 4.5 * 60 * 1000,
  // Blank teacher names too (column 149). Off by default; the dashboard shows them.
  REDACT_TEACHER_NAMES: false,
}

// Columns with personal data, with the start of the header each must have.
// A file whose headers don't match is skipped, never exported unredacted.
const REDACT = [
  [53, 'यदि हाँ, तो किन्हीं 5 बच्चों'], // five students' names (FLN Maths)
  [56, '5 random students'],
  [59, 'ऐसे दो मुख्य सुधार के क्षेत्र'], // free-text remarks
  [60, 'आज HM एवं सभी शिक्षकों'],
  [81, 'शिक्षक बच्चों के साथ क्या कार्य कर रहे हैं'],
  [107, 'शिक्षक बच्चों के साथ क्या कार्य कर रहे हैं'],
  [128, 'शिक्षक द्वारा बच्चों के साथ क्या कार्य किया जा रहा है'],
  [140, 'यदि हाँ, तो किन्हीं 5 बच्चों'], // five students' names (FLN Hindi)
  [144, '5 random students'],
  [147, 'ऐसे दो मुख्य सुधार के क्षेत्र'],
  [148, 'आज HM एवं सभी शिक्षकों'],
  [150, 'शिक्षक का मानव संपदा कोड'], // teacher HRMS code
  [152, 'शिक्षक का मोबाइल नंबर'], // teacher mobile
  [175, 'पिछले विज़िट के दौरान दिए गए सुझावों'],
]
const MENTOR_MOBILE_COL = [8, 'Mobile No'] // replaced by a salted hash: the dashboard's mentor ID
const TEACHER_NAME_COL = [149, 'शिक्षक का नाम']
const EXPECTED_COLUMNS = 208

// ---------------------------------------------------------------- entry points

/** Create the nightly trigger and the salt. Run once. */
function setup() {
  const props = PropertiesService.getScriptProperties()
  if (!props.getProperty('HASH_SALT')) props.setProperty('HASH_SALT', Utilities.getUuid())
  if (!props.getProperty('GITHUB_TOKEN')) throw new Error('Add GITHUB_TOKEN under Project Settings > Script properties first.')
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runExport')
    .forEach((t) => ScriptApp.deleteTrigger(t))
  props.deleteProperty('CONTINUATION_TRIGGER')
  ScriptApp.newTrigger('runExport').timeBased().everyDays(1).atHour(2).inTimezone('Asia/Kolkata').create()
  console.log('Nightly trigger created. Starting the first export now.')
  runExport()
}

/** Export every new or changed district file, as many as fit in one run. */
function runExport() {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(1000)) return console.log('Another export is running.')
  const started = Date.now()
  try {
    const todo = findChangedFiles_()
    console.log(`${todo.length} file(s) to export`)
    const done = []
    const entries = []
    for (const item of todo) {
      if (Date.now() - started > CONFIG.TIME_BUDGET_MS) break
      try {
        const gz = exportFile_(item.file)
        const blobSha = github_('post', '/git/blobs', { content: Utilities.base64Encode(gz.getBytes()), encoding: 'base64' }).sha
        entries.push({ path: `${CONFIG.EXPORT_DIR}/${item.month}/${item.district}.csv.gz`, mode: '100644', type: 'blob', sha: blobSha })
        done.push(item)
        console.log(`exported ${item.month}/${item.district}`)
      } catch (e) {
        console.error(`skipped ${item.month}/${item.district}: ${e.message}`)
      }
    }
    if (entries.length) {
      commit_(entries, `Data export: ${entries.length} file(s) (${done.map((d) => `${d.month}/${d.district}`).slice(0, 6).join(', ')}${done.length > 6 ? ', …' : ''})`)
      const props = PropertiesService.getScriptProperties()
      done.forEach((d) => props.setProperty(`f_${d.file.getId()}`, String(d.file.getLastUpdated().getTime())))
    }
    const left = todo.length - done.length
    PropertiesService.getScriptProperties().setProperty(
      'LAST_RUN',
      JSON.stringify({ at: new Date().toISOString(), exported: done.length, remaining: left }),
    )
    // Backfill: keep going in a fresh run rather than hitting the 6-minute limit.
    clearContinuation_()
    if (left > 0 && done.length > 0) {
      const t = ScriptApp.newTrigger('runExport').timeBased().after(60 * 1000).create()
      PropertiesService.getScriptProperties().setProperty('CONTINUATION_TRIGGER', t.getUniqueId())
    }
    console.log(`done: ${done.length} exported, ${left} remaining`)
  } finally {
    lock.releaseLock()
  }
}

/** What has been exported, and what's still waiting. */
function status() {
  const props = PropertiesService.getScriptProperties()
  console.log('Last run:', props.getProperty('LAST_RUN'))
  const todo = findChangedFiles_()
  console.log(`${todo.length} file(s) waiting:`, todo.map((t) => `${t.month}/${t.district}`).join(', '))
}

/** Forget what was exported, so the next run re-exports everything. */
function resetState() {
  const props = PropertiesService.getScriptProperties()
  Object.keys(props.getProperties())
    .filter((k) => k.startsWith('f_'))
    .forEach((k) => props.deleteProperty(k))
  console.log('Export state cleared.')
}

// ---------------------------------------------------------------- Drive

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "Aug 2026", "Sept 2025", "July 2026", "April 2025" -> "2026-08" (null if not a month folder). */
function monthKey_(folderName) {
  const m = folderName.trim().toLowerCase().match(/^([a-z]+)\.?\s+(\d{4})$/)
  if (!m || !MONTHS[m[1].slice(0, 3)]) return null
  return `${m[2]}-${String(MONTHS[m[1].slice(0, 3)]).padStart(2, '0')}`
}

function findChangedFiles_() {
  const props = PropertiesService.getScriptProperties()
  const wanted = new Set(CONFIG.DISTRICTS)
  const out = []
  const years = DriveApp.getFolderById(CONFIG.SOURCE_FOLDER_ID).getFolders()
  while (years.hasNext()) {
    const months = years.next().getFolders()
    while (months.hasNext()) {
      const folder = months.next()
      const month = monthKey_(folder.getName())
      if (!month) continue
      const files = folder.getFiles()
      while (files.hasNext()) {
        const file = files.next()
        const district = file.getName().replace(/\.xlsx$/i, '').trim().toUpperCase()
        if (!wanted.has(district)) continue
        const seen = props.getProperty(`f_${file.getId()}`)
        if (seen && Number(seen) >= file.getLastUpdated().getTime()) continue
        out.push({ file, month, district })
      }
    }
  }
  return out.sort((a, b) => (a.month + a.district).localeCompare(b.month + b.district))
}

/** Copy an .xlsx as a temporary Sheet, redact it, and return a gzipped CSV blob. */
function exportFile_(file) {
  const tmp = Drive.Files.copy(
    { name: `tmp-export-${file.getName()}`, mimeType: MimeType.GOOGLE_SHEETS, parents: [tempFolderId_()] },
    file.getId(),
    { supportsAllDrives: true },
  )
  try {
    const values = SpreadsheetApp.openById(tmp.id).getSheets()[0].getDataRange().getDisplayValues()
    const rows = redact_(values, file.getName())
    const csv = rows.map((r) => r.map(csvCell_).join(',')).join('\n')
    return Utilities.gzip(Utilities.newBlob(csv, 'text/csv', 'export.csv'))
  } finally {
    DriveApp.getFileById(tmp.id).setTrashed(true)
  }
}

function tempFolderId_() {
  const props = PropertiesService.getScriptProperties()
  let id = props.getProperty('TEMP_FOLDER_ID')
  if (id) {
    try {
      DriveApp.getFolderById(id)
      return id
    } catch (e) {
      // folder was deleted; make a new one
    }
  }
  id = DriveApp.createFolder('ARP dashboard - export temp (safe to ignore)').getId()
  props.setProperty('TEMP_FOLDER_ID', id)
  return id
}

// ---------------------------------------------------------------- redaction

function norm_(s) {
  return String(s).normalize('NFC').replace(/\s+/g, ' ').trim()
}

function redact_(values, name) {
  if (!values.length) throw new Error('empty sheet')
  const header = values[0].map(norm_)
  if (header.length < EXPECTED_COLUMNS) throw new Error(`${name}: ${header.length} columns, expected ${EXPECTED_COLUMNS}`)
  const checks = [...REDACT, MENTOR_MOBILE_COL, ...(CONFIG.REDACT_TEACHER_NAMES ? [TEACHER_NAME_COL] : [])]
  for (const [col, prefix] of checks) {
    if (!header[col].startsWith(norm_(prefix))) {
      throw new Error(`${name}: column ${col} is "${header[col].slice(0, 50)}", expected "${prefix}" - layout changed, not exporting`)
    }
  }
  const blank = new Set(checks.map(([c]) => c).filter((c) => c !== MENTOR_MOBILE_COL[0]))
  // Belt and braces: any other column that looks like a phone number or HRMS code.
  header.forEach((h, c) => {
    if (c !== MENTOR_MOBILE_COL[0] && (/mobile|phone/i.test(h) || h.includes('मोबाइल') || h.includes('मानव संपदा'))) blank.add(c)
  })
  const salt = PropertiesService.getScriptProperties().getProperty('HASH_SALT')
  if (!salt) throw new Error('HASH_SALT missing - run setup()')
  return values.map((row, i) => {
    if (i === 0) return row.slice(0, EXPECTED_COLUMNS)
    const out = row.slice(0, EXPECTED_COLUMNS)
    blank.forEach((c) => (out[c] = ''))
    const mob = String(out[MENTOR_MOBILE_COL[0]]).trim()
    out[MENTOR_MOBILE_COL[0]] = mob ? pseudonym_(mob, salt) : ''
    return out
  })
}

/** Stable, non-reversible mentor ID from a mobile number. */
function pseudonym_(mobile, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${salt}:${mobile}`, Utilities.Charset.UTF_8)
  return 'm' + digest.slice(0, 6).map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('')
}

function csvCell_(v) {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ---------------------------------------------------------------- GitHub

function github_(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN')
  if (!token) throw new Error('GITHUB_TOKEN script property is not set')
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${CONFIG.GITHUB_REPO}${path}`, {
    method,
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  })
  const code = res.getResponseCode()
  if (code >= 300) throw new Error(`GitHub ${method.toUpperCase()} ${path} -> ${code}: ${res.getContentText().slice(0, 300)}`)
  return JSON.parse(res.getContentText())
}

/** One commit containing every file exported in this run. */
function commit_(entries, message) {
  const ref = `/git/ref/heads/${CONFIG.GITHUB_BRANCH}`
  const head = github_('get', ref).object.sha
  const baseTree = github_('get', `/git/commits/${head}`).tree.sha
  const tree = github_('post', '/git/trees', { base_tree: baseTree, tree: entries }).sha
  const commit = github_('post', '/git/commits', { message, tree, parents: [head] }).sha
  github_('patch', `/git/refs/heads/${CONFIG.GITHUB_BRANCH}`, { sha: commit })
  console.log(`committed ${entries.length} file(s): ${commit.slice(0, 7)}`)
}

function clearContinuation_() {
  const props = PropertiesService.getScriptProperties()
  const id = props.getProperty('CONTINUATION_TRIGGER')
  if (!id) return
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getUniqueId() === id)
    .forEach((t) => ScriptApp.deleteTrigger(t))
  props.deleteProperty('CONTINUATION_TRIGGER')
}
