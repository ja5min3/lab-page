/**
 * 實驗室耗材盤點 —— Google 試算表後端
 *
 * 部署方式見 README.md。重點：
 *   · 這支腳本要「從試算表建立」（擴充功能 → Apps Script），走 getActiveSpreadsheet()，
 *     所以不需要在程式裡填試算表 ID。
 *   · 部署為網頁應用程式：執行身分「我」、存取權「任何人」。
 *   · 讀取（doGet）不需要密碼；所有寫入（doPost）都要密碼。
 *   · 密碼存在 Script Properties，不寫死在這個檔案裡。設定方式：
 *     在編輯器選 setWriteToken 函式跑一次（先把下面那行的密碼改掉）。
 */

var SHEET_NAME = '庫存';
var HEADERS = ['id', '類別', '品項', '顏色／規格', '數量', '單位', '備註', '最後更新', '更新者'];
var PROP_TOKEN = 'WRITE_TOKEN';
var PROP_OPLOG = 'OP_LOG';
var OPLOG_MAX = 300;   // 記住最近幾個 opId，用來擋重送

/** 設定寫入密碼：改掉下面的字串，在編輯器選這個函式按執行，跑一次即可。 */
function setWriteToken() {
  var newToken = '在這裡填你要的密碼';
  if (newToken === '在這裡填你要的密碼') {
    throw new Error('請先把 newToken 改成你要的密碼再執行。');
  }
  PropertiesService.getScriptProperties().setProperty(PROP_TOKEN, newToken);
  return '密碼已設定';
}

/* ---------- 試算表存取 ---------- */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  var head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (head.join('') !== HEADERS.join('')) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_() {
  var sh = sheet_();
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  var rows = sh.getRange(2, 1, n, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!String(r[0]).trim()) continue;      // 沒有 id 的列略過
    out.push({
      id: String(r[0]), cat: String(r[1]), name: String(r[2]), spec: String(r[3]),
      qty: Number(r[4]) || 0, unit: String(r[5]), note: String(r[6]),
      updated: String(r[7]), by: String(r[8])
    });
  }
  return out;
}

// 品項數量是幾十筆等級，整表重寫最單純，而且在 LockService 保護下不會有半套狀態
function writeAll_(items) {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
  if (!items.length) return;
  var rows = items.map(function (it) {
    return [it.id, it.cat, it.name, it.spec, it.qty, it.unit, it.note, it.updated, it.by || ''];
  });
  sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
}

/* ---------- 工具 ---------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function norm_(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

function same_(a, cat, name, spec) {
  return norm_(a.cat) === norm_(cat) && norm_(a.name) === norm_(name) && norm_(a.spec) === norm_(spec);
}

function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function checkToken_(given) {
  var want = PropertiesService.getScriptProperties().getProperty(PROP_TOKEN);
  if (!want) throw new Error('伺服器還沒設定寫入密碼，請先執行 setWriteToken。');
  return String(given || '') === want;
}

/**
 * 擋重送：網路不穩時同一個操作可能送兩次，而 adjust（±1）不是冪等的，
 * 重送會多加一次。記住做過的 opId，遇到重複就直接回現況。
 */
function seenOp_(opId) {
  if (!opId) return false;
  var props = PropertiesService.getScriptProperties();
  var log = [];
  try { log = JSON.parse(props.getProperty(PROP_OPLOG) || '[]'); } catch (e) { log = []; }
  if (log.indexOf(opId) >= 0) return true;
  log.push(opId);
  if (log.length > OPLOG_MAX) log = log.slice(log.length - OPLOG_MAX);
  props.setProperty(PROP_OPLOG, JSON.stringify(log));
  return false;
}

/* ---------- 讀取 ---------- */

function doGet() {
  try {
    return json_({ ok: true, items: readAll_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* ---------- 寫入 ---------- */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // 兩個人同時按 +1 時，讓後到的等前一個做完，不要互相蓋掉
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, error: '伺服器忙碌中，請稍後再試' });
  }

  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (!checkToken_(req.token)) {
      return json_({ ok: false, error: 'BAD_TOKEN' });
    }

    // 重送的操作直接回現況，不重複套用
    if (seenOp_(req.opId)) {
      return json_({ ok: true, items: readAll_(), deduped: true });
    }

    var items = readAll_();
    var by = String(req.by || '').slice(0, 40);
    var p = req.payload || {};

    switch (req.action) {
      case 'upsert': {
        // 有 id 就更新那一筆；沒有就找同類別＋品項＋規格的累加，都沒有才新增
        var hit = null;
        if (p.id) {
          for (var i = 0; i < items.length; i++) if (items[i].id === p.id) { hit = items[i]; break; }
        }
        if (hit) {
          hit.cat = p.cat; hit.name = p.name; hit.spec = p.spec;
          hit.qty = Math.max(0, Number(p.qty) || 0);
          hit.unit = p.unit; hit.note = p.note;
          hit.updated = stamp_(); hit.by = by;
          break;
        }
        var merge = null;
        for (var j = 0; j < items.length; j++) {
          if (same_(items[j], p.cat, p.name, p.spec)) { merge = items[j]; break; }
        }
        if (merge) {
          merge.qty = Math.max(0, (Number(merge.qty) || 0) + (Number(p.qty) || 0));
          if (p.unit) merge.unit = p.unit;
          if (p.note) merge.note = p.note;
          merge.updated = stamp_(); merge.by = by;
        } else {
          items.push({
            id: String(p.id || ('i' + Date.now() + Math.random().toString(36).slice(2, 7))),
            cat: p.cat, name: p.name, spec: p.spec,
            qty: Math.max(0, Number(p.qty) || 0),
            unit: p.unit, note: p.note, updated: stamp_(), by: by
          });
        }
        break;
      }

      case 'adjust': {
        for (var k = 0; k < items.length; k++) {
          if (items[k].id === p.id) {
            items[k].qty = Math.max(0, (Number(items[k].qty) || 0) + (Number(p.delta) || 0));
            items[k].updated = stamp_(); items[k].by = by;
            break;
          }
        }
        break;
      }

      case 'delete': {
        items = items.filter(function (it) { return it.id !== p.id; });
        break;
      }

      case 'bulkUpload': {
        // CSV 匯入與第一次把本機資料推上來都走這裡
        var incoming = (p.items || []).map(function (it) {
          return {
            id: String(it.id || ('i' + Date.now() + Math.random().toString(36).slice(2, 7))),
            cat: it.cat, name: it.name, spec: it.spec,
            qty: Math.max(0, Number(it.qty) || 0),
            unit: it.unit, note: it.note, updated: it.updated || stamp_(), by: by
          };
        });
        if (p.mode === 'replace') {
          items = incoming;
        } else {
          incoming.forEach(function (inc) {
            var m = null;
            for (var x = 0; x < items.length; x++) if (same_(items[x], inc.cat, inc.name, inc.spec)) { m = items[x]; break; }
            if (m) {
              m.qty = Math.max(0, (Number(m.qty) || 0) + inc.qty);
              if (inc.unit) m.unit = inc.unit;
              if (inc.note) m.note = inc.note;
              m.updated = stamp_(); m.by = by;
            } else {
              items.push(inc);
            }
          });
        }
        break;
      }

      case 'clearAll': {
        items = [];
        break;
      }

      default:
        return json_({ ok: false, error: '不認得的操作：' + req.action });
    }

    writeAll_(items);
    return json_({ ok: true, items: items });

  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
